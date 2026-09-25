import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { StoreService } from '../store/store.service.js';
import type { AgentTool, ToolDefinition } from './tool.js';

const input = z.object({
  query: z.string().trim().min(1).max(100),
});

@Injectable()
export class SearchProductsTool implements AgentTool<typeof input> {
  constructor(private readonly store: StoreService) {}

  readonly input = input;

  readonly definition: ToolDefinition = {
    name: 'searchProducts',
    description:
      'Search the parts the store currently sells. Matches the product ' +
      'name, the part number and alternative (cross reference) part ' +
      'numbers. Use a part number when the customer has one, otherwise a ' +
      'short name like "brake pad" or "oil filter". Returns at most 5 ' +
      'products with price in FCFA and quantity in stock. An empty list ' +
      'means the store does not list that part; do not invent products.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'A part number or a few words from the part name',
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
  };

  async run({ query }: z.infer<typeof input>) {
    const products = await this.store.searchProducts(query);
    return {
      products: products.map((p) => ({
        name: p.name,
        partNumber: p.partNumber,
        crossReference: p.crossReference,
        condition: p.condition,
        priceFcfa: p.price,
        inStock: p.quantity > 0,
        quantity: p.quantity,
        slug: p.slug,
      })),
    };
  }
}
