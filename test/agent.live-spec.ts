import { Test } from '@nestjs/testing';
import type { INestApplicationContext } from '@nestjs/common';
import { Pool } from 'pg';
import { AgentService } from '../src/agent/agent.service.js';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

// The whole agent against the real model (Gemini), the real store and the
// agent database. The model's wording varies, so these tests only check what
// must always happen: which tools ran and how the conversation ended.
describe('Agent with the real model (live)', () => {
  let app: INestApplicationContext;
  let agent: AgentService;
  let prisma: PrismaService;
  const conversations: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = await moduleRef.init();
    agent = app.get(AgentService);
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await prisma.conversation.deleteMany({
      where: { id: { in: conversations } },
    });
    await app.close();
  });

  async function start() {
    const id = await agent.startConversation('WEB');
    conversations.push(id);
    return id;
  }

  const toolsUsed = async (conversationId: string) =>
    (
      await prisma.toolCall.findMany({
        where: { conversationId },
        orderBy: { createdAt: 'asc' },
      })
    ).map((call) => ({ name: call.name, output: call.output }));

  it('looks up an order when given the number and phone', async () => {
    const store = new Pool({
      connectionString: process.env.STORE_READONLY_URL,
    });
    const { rows } = await store.query<{
      orderNumber: string;
      shippingPhone: string;
      status: string;
    }>(
      `SELECT "orderNumber", "shippingPhone", status FROM orders
        WHERE length(regexp_replace("shippingPhone", '\\D', '', 'g')) >= 9
        LIMIT 1`,
    );
    await store.end();
    const { orderNumber, shippingPhone, status } = rows[0];
    const id = await start();

    const result = await agent.reply(
      id,
      `Hello, what is the status of my order ${orderNumber}? My phone number is ${shippingPhone}.`,
    );

    console.log(`[order ${status}] ${result.reply}`);
    expect(result.status).toBe('OPEN');
    expect(await toolsUsed(id)).toContainEqual({
      name: 'getOrder',
      output: expect.objectContaining({ found: true }),
    });
  });

  it('asks for the phone number instead of looking up without it', async () => {
    const id = await start();

    const result = await agent.reply(
      id,
      'Where is my order ORD-20260924-AB12CD?',
    );

    console.log(`[no phone] ${result.reply}`);
    expect(result.status).toBe('OPEN');
    expect(await toolsUsed(id)).toEqual([]);
  });

  it('escalates a refund request to a human', async () => {
    const id = await start();

    const result = await agent.reply(
      id,
      'The brake pads you sent me are the wrong size. I want my money back.',
    );

    console.log(`[refund] ${result.reply}`);
    expect(result.status).toBe('ESCALATED');
    expect((await toolsUsed(id)).map((t) => t.name)).toContain(
      'escalateToHuman',
    );
  });

  it('answers in French when the customer writes in French', async () => {
    const id = await start();

    const result = await agent.reply(
      id,
      'Bonjour, est-ce que vous vendez des filtres à huile ?',
    );

    console.log(`[french] ${result.reply}`);
    expect(result.status).toBe('OPEN');
    expect((await toolsUsed(id)).map((t) => t.name)).toContain(
      'searchProducts',
    );
  });
});
