import type { PrismaService } from '../prisma/prisma.service.js';
import type { CustomerOrder, StoreService } from '../store/store.service.js';
import { EscalateToHumanTool } from './escalate-to-human.tool.js';
import { GetOrderTool, MAX_FAILED_LOOKUPS } from './get-order.tool.js';
import { SearchProductsTool } from './search-products.tool.js';
import { ToolExecutor } from './tool-executor.service.js';
import type { ToolCall } from './tool.js';

const context = { conversationId: 'conv-1' };

function setup() {
  const store = {
    findOrderForCustomer: vi.fn(),
    searchProducts: vi.fn(),
  };
  const prisma = {
    toolCall: { count: vi.fn().mockResolvedValue(0), create: vi.fn() },
    conversation: { update: vi.fn() },
  };
  const s = store as unknown as StoreService;
  const p = prisma as unknown as PrismaService;
  const tools = {
    getOrder: new GetOrderTool(s, p),
    searchProducts: new SearchProductsTool(s),
    escalateToHuman: new EscalateToHumanTool(p),
  };
  const executor = new ToolExecutor(
    p,
    tools.getOrder,
    tools.searchProducts,
    tools.escalateToHuman,
  );
  return { store, prisma, tools, executor };
}

function toolUse(name: string, input: unknown, id = 'call_1'): ToolCall {
  return { id, name, input };
}

const order: CustomerOrder = {
  orderNumber: 'ORD-20260924-AB12CD',
  status: 'SHIPPED',
  subtotal: 45000,
  shippingTotal: 2000,
  discountTotal: 0,
  total: 47000,
  shippingCity: 'Douala',
  createdAt: new Date('2026-09-20T10:00:00Z'),
  updatedAt: new Date('2026-09-22T10:00:00Z'),
  items: [{ productName: 'Brake pad', unitPrice: 15000, quantity: 3 }],
};

describe('tool definitions', () => {
  it('are sent to the model in a fixed order, closed to extra fields', () => {
    const { executor } = setup();
    expect(executor.definitions.map((d) => d.name)).toEqual([
      'getOrder',
      'searchProducts',
      'escalateToHuman',
    ]);
    for (const definition of executor.definitions) {
      expect(definition.parameters.additionalProperties).toBe(false);
    }
  });
});

describe('getOrder', () => {
  it('returns the order when number and phone match', async () => {
    const { store, tools } = setup();
    store.findOrderForCustomer.mockResolvedValue(order);

    await expect(
      tools.getOrder.run(
        { order_number: 'ORD-20260924-AB12CD', phone: '670123456' },
        context,
      ),
    ).resolves.toEqual({ found: true, order });
  });

  it('reports found: false when nothing matches', async () => {
    const { store, tools } = setup();
    store.findOrderForCustomer.mockResolvedValue(null);

    await expect(
      tools.getOrder.run({ order_number: 'X', phone: '670123456' }, context),
    ).resolves.toMatchObject({ found: false });
  });

  it('counts only failed getOrder calls of this conversation', async () => {
    const { store, prisma, tools } = setup();
    store.findOrderForCustomer.mockResolvedValue(null);

    await tools.getOrder.run({ order_number: 'X', phone: '1' }, context);

    expect(prisma.toolCall.count).toHaveBeenCalledWith({
      where: {
        conversationId: 'conv-1',
        name: 'getOrder',
        output: { path: ['found'], equals: false },
      },
    });
  });

  it(`stops checking after ${MAX_FAILED_LOOKUPS} failed lookups, even with the right phone`, async () => {
    const { store, prisma, tools } = setup();
    prisma.toolCall.count.mockResolvedValue(MAX_FAILED_LOOKUPS);
    store.findOrderForCustomer.mockResolvedValue(order);

    const result = await tools.getOrder.run(
      { order_number: 'ORD-20260924-AB12CD', phone: '670123456' },
      context,
    );

    expect(result).toMatchObject({ found: null });
    expect(store.findOrderForCustomer).not.toHaveBeenCalled();
  });
});

describe('searchProducts', () => {
  it('returns products with stock shown as inStock and quantity', async () => {
    const { store, tools } = setup();
    store.searchProducts.mockResolvedValue([
      {
        name: 'Brake pad set',
        slug: 'brake-pad-set',
        partNumber: 'BP-100',
        crossReference: [],
        condition: 'NEW',
        price: 15000,
        quantity: 0,
      },
    ]);

    const result = await tools.searchProducts.run({ query: 'brake pad' });

    expect(store.searchProducts).toHaveBeenCalledWith('brake pad');
    expect(result.products[0]).toMatchObject({
      priceFcfa: 15000,
      inStock: false,
      quantity: 0,
    });
  });
});

describe('escalateToHuman', () => {
  it('marks the conversation as escalated with the reason', async () => {
    const { prisma, tools } = setup();

    await tools.escalateToHuman.run(
      { reason: 'Customer wants a refund' },
      context,
    );

    expect(prisma.conversation.update).toHaveBeenCalledWith({
      where: { id: 'conv-1' },
      data: {
        status: 'ESCALATED',
        escalationReason: 'Customer wants a refund',
        closedAt: expect.any(Date),
      },
    });
  });
});

describe('ToolExecutor', () => {
  it('runs a tool, records it and returns a tool_result', async () => {
    const { store, prisma, executor } = setup();
    store.findOrderForCustomer.mockResolvedValue(order);

    const result = await executor.run(
      toolUse('getOrder', {
        order_number: ' ORD-20260924-AB12CD ',
        phone: '670123456',
      }),
      context,
    );

    // zod trimmed the order number before the tool saw it.
    expect(store.findOrderForCustomer).toHaveBeenCalledWith(
      'ORD-20260924-AB12CD',
      '670123456',
    );
    expect(result).toMatchObject({ callId: 'call_1', isError: false });
    // Dates are sent as ISO strings.
    expect(
      (result.output as { order: { createdAt: string } }).order.createdAt,
    ).toBe('2026-09-20T10:00:00.000Z');
    expect(prisma.toolCall.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        conversationId: 'conv-1',
        toolUseId: 'call_1',
        name: 'getOrder',
        isError: false,
        durationMs: expect.any(Number),
      }),
    });
  });

  it('rejects invalid input without running the tool', async () => {
    const { store, prisma, executor } = setup();

    const result = await executor.run(
      toolUse('getOrder', { order_number: 'ORD-1' }),
      context,
    );

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.output)).toContain('Invalid input');
    expect(store.findOrderForCustomer).not.toHaveBeenCalled();
    expect(prisma.toolCall.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ isError: true }),
    });
  });

  it('answers an unknown tool with an error', async () => {
    const { executor } = setup();

    const result = await executor.run(toolUse('deleteOrder', {}), context);

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.output)).toContain(
      'Unknown tool: deleteOrder',
    );
  });

  it('turns a crash into an error result without leaking the cause', async () => {
    const { store, executor } = setup();
    store.searchProducts.mockRejectedValue(
      new Error('password authentication failed for user "agent_readonly"'),
    );

    const result = await executor.run(
      toolUse('searchProducts', { query: 'filter' }),
      context,
    );

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.output)).toContain('could not be reached');
    expect(JSON.stringify(result.output)).not.toContain('agent_readonly');
  });

  it('returns results in the order the model asked for them', async () => {
    const { store, executor } = setup();
    store.searchProducts.mockResolvedValue([]);

    const results = await executor.runAll(
      [
        toolUse('searchProducts', { query: 'a' }, 'call_a'),
        toolUse('searchProducts', { query: 'b' }, 'call_b'),
      ],
      context,
    );

    expect(results.map((r) => r.callId)).toEqual(['call_a', 'call_b']);
  });
});
