import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service.js';
import { StoreService } from '../store/store.service.js';
import type { AgentTool, ToolContext, ToolDefinition } from './tool.js';

// After this many failed lookups in one conversation, the tool stops
// checking. Without a limit, someone holding an order number could keep
// guessing phone numbers through the agent.
export const MAX_FAILED_LOOKUPS = 3;

const input = z.object({
  order_number: z.string().trim().min(1).max(40),
  phone: z.string().trim().min(1).max(30),
});

@Injectable()
export class GetOrderTool implements AgentTool<typeof input> {
  constructor(
    private readonly store: StoreService,
    private readonly prisma: PrismaService,
  ) {}

  readonly input = input;

  readonly definition: ToolDefinition = {
    name: 'getOrder',
    description:
      "Look up one of the customer's orders: its status, items and totals. " +
      'Both the order number and the phone number used on that order are ' +
      'required, and they must belong to the same order. This is how the ' +
      'customer proves the order is theirs, so ask the customer for both ' +
      'and never guess or reuse a phone number from another order. ' +
      'Order numbers look like ORD-20260924-AB12CD. Prices are in FCFA. ' +
      'If nothing matches, ask the customer to check both values. After ' +
      `${MAX_FAILED_LOOKUPS} failed lookups the tool refuses further attempts; ` +
      'then escalate to a human.',
    parameters: {
      type: 'object',
      properties: {
        order_number: {
          type: 'string',
          description: 'The order number, e.g. ORD-20260924-AB12CD',
        },
        phone: {
          type: 'string',
          description:
            'The phone number the customer gave when ordering, as they type it',
        },
      },
      required: ['order_number', 'phone'],
      additionalProperties: false,
    },
  };

  async run(
    { order_number, phone }: z.infer<typeof input>,
    { conversationId }: ToolContext,
  ) {
    const failed = await this.prisma.toolCall.count({
      where: {
        conversationId,
        name: this.definition.name,
        output: { path: ['found'], equals: false },
      },
    });
    if (failed >= MAX_FAILED_LOOKUPS) {
      return {
        found: null,
        message:
          'Too many failed lookups in this conversation. Do not try again; ' +
          'escalate to a human.',
      };
    }

    const order = await this.store.findOrderForCustomer(order_number, phone);
    if (!order) {
      return {
        found: false,
        message:
          'No order matches this order number and phone number together.',
      };
    }
    return { found: true, order };
  }
}
