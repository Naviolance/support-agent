import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { EscalateToHumanTool } from './escalate-to-human.tool.js';
import { GetOrderTool } from './get-order.tool.js';
import { SearchProductsTool } from './search-products.tool.js';
import type {
  AgentTool,
  ToolCall,
  ToolContext,
  ToolDefinition,
  ToolResult,
} from './tool.js';

// Runs the tool calls the model asks for and returns one result per call for
// the next model request. Every call, including failures, is recorded in the
// tool_calls table.
//
// A failing tool never throws out of here. The model gets a result marked
// isError and can react (apologize, retry differently, escalate), the same
// way a person would if a lookup failed.
@Injectable()
export class ToolExecutor {
  private readonly logger = new Logger(ToolExecutor.name);
  private readonly tools: Map<string, AgentTool>;

  constructor(
    private readonly prisma: PrismaService,
    getOrder: GetOrderTool,
    searchProducts: SearchProductsTool,
    escalateToHuman: EscalateToHumanTool,
  ) {
    const all: AgentTool[] = [getOrder, searchProducts, escalateToHuman];
    this.tools = new Map(all.map((tool) => [tool.definition.name, tool]));
  }

  // The tool list sent to the model on every request, always in the same
  // order.
  get definitions(): ToolDefinition[] {
    return [...this.tools.values()].map((tool) => tool.definition);
  }

  // The model can ask for several tools in one turn. They run concurrently,
  // and all results go back together, in the order they were asked for.
  async runAll(calls: ToolCall[], context: ToolContext): Promise<ToolResult[]> {
    return Promise.all(calls.map((call) => this.run(call, context)));
  }

  async run(call: ToolCall, context: ToolContext): Promise<ToolResult> {
    const started = Date.now();
    const { output, isError } = await this.execute(call, context);

    await this.prisma.toolCall.create({
      data: {
        conversationId: context.conversationId,
        toolUseId: call.id,
        name: call.name,
        input: (call.input ?? {}) as Prisma.InputJsonValue,
        output: output as Prisma.InputJsonValue,
        isError,
        durationMs: Date.now() - started,
      },
    });

    return { callId: call.id, name: call.name, output, isError };
  }

  private async execute(
    call: ToolCall,
    context: ToolContext,
  ): Promise<{ output: unknown; isError: boolean }> {
    const tool = this.tools.get(call.name);
    if (!tool) {
      return { output: { error: `Unknown tool: ${call.name}` }, isError: true };
    }

    // The model is told the JSON Schema but can still send something else.
    // This check enforces it, and adds what JSON Schema does not say
    // (trimming, length limits).
    const parsed = tool.input.safeParse(call.input);
    if (!parsed.success) {
      return {
        output: { error: `Invalid input: ${z.prettifyError(parsed.error)}` },
        isError: true,
      };
    }

    try {
      const result = await tool.run(parsed.data, context);
      // JSON round trip: Dates become ISO strings, the same value is stored
      // and sent to the model.
      return { output: JSON.parse(JSON.stringify(result)), isError: false };
    } catch (error) {
      // The real error goes to our logs. The model, and through it the
      // customer, only learns that the lookup failed.
      this.logger.error(`Tool ${call.name} failed`, error);
      return {
        output: {
          error:
            'The store system could not be reached. Try once more, or escalate to a human.',
        },
        isError: true,
      };
    }
  }
}
