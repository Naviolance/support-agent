import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AgentTool, ToolContext, ToolDefinition } from './tool.js';

const input = z.object({
  reason: z.string().trim().min(1).max(500),
});

// The only tool that writes, and it writes to the agent's own database, never
// to the store. It marks the conversation so a human can pick it up.
@Injectable()
export class EscalateToHumanTool implements AgentTool<typeof input> {
  constructor(private readonly prisma: PrismaService) {}

  readonly input = input;

  readonly definition: ToolDefinition = {
    name: 'escalateToHuman',
    description:
      'Hand the conversation to a human from the store team. Use it when ' +
      'the customer asks for a person, wants a refund, cancellation or ' +
      'change to an order, reports a wrong or damaged part, is upset, ' +
      'cannot verify their order after several tries, or when the tools ' +
      'cannot answer the question. After calling it, tell the customer ' +
      'that someone from the team will contact them, and stop helping ' +
      'with the request yourself.',
    parameters: {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          description:
            'One or two sentences for the human: what the customer wants and why you could not handle it',
        },
      },
      required: ['reason'],
      additionalProperties: false,
    },
  };

  async run(
    { reason }: z.infer<typeof input>,
    { conversationId }: ToolContext,
  ) {
    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: {
        status: 'ESCALATED',
        escalationReason: reason,
        closedAt: new Date(),
      },
    });
    return {
      escalated: true,
      message: 'A human from the store team will take over this conversation.',
    };
  }
}
