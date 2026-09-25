import { Test } from '@nestjs/testing';
import type { INestApplicationContext } from '@nestjs/common';
import { Pool } from 'pg';
import {
  AgentService,
  FALLBACK_REPLY,
  HANDED_OFF_REPLY,
  MAX_MODEL_CALLS,
} from '../src/agent/agent.service.js';
import { AppModule } from '../src/app.module.js';
import {
  MODEL_CLIENT,
  type ModelClient,
  type ModelRequest,
  type ModelTurn,
} from '../src/model/model-client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import type { ToolCall, ToolResult } from '../src/tools/tool.js';

// A fake model that plays back scripted turns. It lets these tests run the
// real loop, real tools and both real databases without calling Gemini:
// free, fast, and the same result every time.
class ScriptedModel implements ModelClient {
  script: (Partial<ModelTurn> | Error)[] = [];
  requests: ModelRequest[] = [];

  userMessage(text: string) {
    return { from: 'user', text };
  }

  toolResultsMessage(results: ToolResult[]) {
    return { from: 'tools', results };
  }

  async generate(request: ModelRequest): Promise<ModelTurn> {
    // Copy: the loop reuses nothing, but keep what the model saw at the time.
    this.requests.push(structuredClone(request));
    const next = this.script.shift();
    if (!next) throw new Error('The script has no more turns');
    if (next instanceof Error) throw next;
    const toolCalls = next.toolCalls ?? [];
    return {
      text: next.text ?? '',
      toolCalls,
      finished: next.finished ?? true,
      stopReason: next.stopReason ?? 'STOP',
      message: { from: 'model', text: next.text ?? '', toolCalls },
      usage: { inputTokens: 100, outputTokens: 20 },
    };
  }
}

const call = (name: string, input: unknown, id = `call_${name}`): ToolCall => ({
  id,
  name,
  input,
});

describe('Agent loop (e2e, scripted model)', () => {
  let app: INestApplicationContext;
  let agent: AgentService;
  let prisma: PrismaService;
  let model: ScriptedModel;
  let conversationId: string;

  beforeAll(async () => {
    model = new ScriptedModel();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MODEL_CLIENT)
      .useValue(model)
      .compile();
    app = await moduleRef.init();
    agent = app.get(AgentService);
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    model.script = [];
    model.requests = [];
    conversationId = await agent.startConversation('WEB');
  });

  afterEach(async () => {
    await prisma.conversation.delete({ where: { id: conversationId } });
  });

  afterAll(async () => {
    await app.close();
  });

  const storedMessages = () =>
    prisma.message.findMany({
      where: { conversationId },
      orderBy: { seq: 'asc' },
    });

  it('answers directly and stores both turns with token usage', async () => {
    model.script = [{ text: 'Hello! How can I help?' }];

    const result = await agent.reply(conversationId, 'Hi');

    expect(result).toEqual({
      conversationId,
      reply: 'Hello! How can I help?',
      status: 'OPEN',
    });
    const messages = await storedMessages();
    expect(messages.map((m) => m.role)).toEqual(['USER', 'ASSISTANT']);
    expect(messages[1]).toMatchObject({ inputTokens: 100, outputTokens: 20 });
    expect(model.requests[0].tools.map((t) => t.name)).toEqual([
      'getOrder',
      'searchProducts',
      'escalateToHuman',
    ]);
  });

  it('runs a tool on the real store and gives the result to the model', async () => {
    const store = new Pool({
      connectionString: process.env.STORE_READONLY_URL,
    });
    const { rows } = await store.query<{
      orderNumber: string;
      shippingPhone: string;
    }>(
      `SELECT "orderNumber", "shippingPhone" FROM orders
        WHERE length(regexp_replace("shippingPhone", '\\D', '', 'g')) >= 9
        LIMIT 1`,
    );
    await store.end();
    const { orderNumber, shippingPhone } = rows[0];

    model.script = [
      {
        toolCalls: [
          call('getOrder', { order_number: orderNumber, phone: shippingPhone }),
        ],
      },
      { text: 'Your order is on its way.' },
    ];

    const result = await agent.reply(
      conversationId,
      `Where is ${orderNumber}? My phone is ${shippingPhone}`,
    );

    expect(result.reply).toBe('Your order is on its way.');
    // The second model call saw: the question, its own tool call, the result.
    const secondRequest = model.requests[1].history as {
      from: string;
      results?: ToolResult[];
    }[];
    expect(secondRequest.map((m) => m.from)).toEqual([
      'user',
      'model',
      'tools',
    ]);
    expect(secondRequest[2].results?.[0]).toMatchObject({
      callId: 'call_getOrder',
      isError: false,
      output: { found: true },
    });
    expect(await prisma.toolCall.count({ where: { conversationId } })).toBe(1);
    expect((await storedMessages()).map((m) => m.role)).toEqual([
      'USER',
      'ASSISTANT',
      'USER',
      'ASSISTANT',
    ]);
  });

  it('keeps earlier messages in the history of the next one', async () => {
    model.script = [{ text: 'Which part?' }, { text: 'Let me check.' }];

    await agent.reply(conversationId, 'I need a part');
    await agent.reply(conversationId, 'A brake pad');

    expect(model.requests[1].history).toHaveLength(3);
  });

  it('stops answering once escalated, but keeps the customer messages', async () => {
    model.script = [
      { toolCalls: [call('escalateToHuman', { reason: 'Wants a refund' })] },
      { text: 'Someone from the team will contact you.' },
    ];

    const first = await agent.reply(conversationId, 'I want a refund');
    expect(first.status).toBe('ESCALATED');

    const second = await agent.reply(conversationId, 'Hello?');
    expect(second).toMatchObject({
      reply: HANDED_OFF_REPLY,
      status: 'ESCALATED',
    });
    expect(model.requests).toHaveLength(2); // no model call for "Hello?"
    const messages = await storedMessages();
    expect(messages.at(-1)).toMatchObject({
      role: 'USER',
      content: { from: 'user', text: 'Hello?' },
    });
  });

  it('hands over to a human when the model cannot be reached', async () => {
    model.script = [new Error('503 Service Unavailable')];

    const result = await agent.reply(conversationId, 'Hi');

    expect(result).toMatchObject({
      reply: FALLBACK_REPLY,
      status: 'ESCALATED',
    });
    const conversation = await prisma.conversation.findUniqueOrThrow({
      where: { id: conversationId },
    });
    expect(conversation.escalationReason).toContain('could not be reached');
  });

  it('hands over when the model stops without a usable answer', async () => {
    model.script = [{ text: 'Partial', finished: false, stopReason: 'SAFETY' }];

    const result = await agent.reply(conversationId, 'Hi');

    expect(result.status).toBe('ESCALATED');
    const conversation = await prisma.conversation.findUniqueOrThrow({
      where: { id: conversationId },
    });
    expect(conversation.escalationReason).toContain('SAFETY');
  });

  it(`stops a model that keeps calling tools after ${MAX_MODEL_CALLS} calls`, async () => {
    model.script = Array.from({ length: MAX_MODEL_CALLS + 5 }, (_, i) => ({
      toolCalls: [call('searchProducts', { query: 'filter' }, `call_${i}`)],
    }));

    const result = await agent.reply(conversationId, 'Search forever');

    expect(result.status).toBe('ESCALATED');
    expect(model.requests).toHaveLength(MAX_MODEL_CALLS);
  });
});
