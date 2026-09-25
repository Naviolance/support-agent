import { Test } from '@nestjs/testing';
import type { INestApplicationContext } from '@nestjs/common';
import { Pool } from 'pg';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { MAX_FAILED_LOOKUPS } from '../src/tools/get-order.tool.js';
import { ToolExecutor } from '../src/tools/tool-executor.service.js';
import type { ToolCall, ToolResult } from '../src/tools/tool.js';

// Runs the tools through ToolExecutor against both real databases: the store
// (read-only, seeded data) and the agent's own (tool_calls, conversations).
describe('Tools (e2e)', () => {
  let app: INestApplicationContext;
  let executor: ToolExecutor;
  let prisma: PrismaService;
  let storePool: Pool;
  let conversationId: string;
  let calls = 0;

  const toolUse = (name: string, input: unknown): ToolCall => ({
    id: `call_e2e_${++calls}`,
    name,
    input,
  });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = await moduleRef.init();
    executor = app.get(ToolExecutor);
    prisma = app.get(PrismaService);
    storePool = new Pool({ connectionString: process.env.STORE_READONLY_URL });
  });

  beforeEach(async () => {
    const conversation = await prisma.conversation.create({
      data: { channel: 'WEB' },
    });
    conversationId = conversation.id;
  });

  afterEach(async () => {
    // tool_calls rows go with it (onDelete: Cascade).
    await prisma.conversation.delete({ where: { id: conversationId } });
  });

  afterAll(async () => {
    await storePool.end();
    await app.close();
  });

  async function realOrder() {
    const { rows } = await storePool.query<{
      orderNumber: string;
      shippingPhone: string;
    }>(
      `SELECT "orderNumber", "shippingPhone" FROM orders
        WHERE length(regexp_replace("shippingPhone", '\\D', '', 'g')) >= 9
        LIMIT 1`,
    );
    return rows[0];
  }

  const parse = (result: ToolResult) =>
    result.output as { found?: boolean | null; products?: unknown[] };

  it('getOrder finds a real order and records the call', async () => {
    const { orderNumber, shippingPhone } = await realOrder();

    const result = await executor.run(
      toolUse('getOrder', { order_number: orderNumber, phone: shippingPhone }),
      { conversationId },
    );

    expect(parse(result)).toMatchObject({ found: true });
    const recorded = await prisma.toolCall.findMany({
      where: { conversationId },
    });
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({ name: 'getOrder', isError: false });
  });

  it(`getOrder refuses after ${MAX_FAILED_LOOKUPS} failed lookups, even with the right phone`, async () => {
    const { orderNumber, shippingPhone } = await realOrder();

    for (let i = 0; i < MAX_FAILED_LOOKUPS; i++) {
      const miss = await executor.run(
        toolUse('getOrder', { order_number: orderNumber, phone: '600000000' }),
        { conversationId },
      );
      expect(parse(miss)).toMatchObject({ found: false });
    }

    const blocked = await executor.run(
      toolUse('getOrder', { order_number: orderNumber, phone: shippingPhone }),
      { conversationId },
    );
    expect(parse(blocked)).toMatchObject({ found: null });
  });

  it('searchProducts returns real published products', async () => {
    const { rows } = await storePool.query<{ name: string }>(
      `SELECT name FROM products WHERE status = 'PUBLISHED' LIMIT 1`,
    );

    const result = await executor.run(
      toolUse('searchProducts', { query: rows[0].name }),
      { conversationId },
    );

    expect(parse(result).products?.length).toBeGreaterThan(0);
  });

  it('escalateToHuman marks the conversation', async () => {
    await executor.run(
      toolUse('escalateToHuman', { reason: 'Customer asks for a refund' }),
      { conversationId },
    );

    const conversation = await prisma.conversation.findUniqueOrThrow({
      where: { id: conversationId },
    });
    expect(conversation).toMatchObject({
      status: 'ESCALATED',
      escalationReason: 'Customer asks for a refund',
    });
    expect(conversation.closedAt).not.toBeNull();
  });
});
