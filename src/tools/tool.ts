import type { z } from 'zod';

// These types are the agent's own, not any AI provider's. The tools and
// ToolExecutor only speak this format; the model client (Gemini today)
// translates to and from the provider's format. Switching providers means
// writing a new model client, not touching the tools.

// How a tool is described to the model.
export interface ToolDefinition {
  name: string;
  // The model reads this to decide when and how to use the tool.
  description: string;
  // Plain JSON Schema for the input.
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required: string[];
    additionalProperties: false;
  };
}

// The model asking to run a tool.
export interface ToolCall {
  id: string; // the provider's id for this call, echoed back with the result
  name: string;
  input: unknown;
}

// What goes back to the model after a tool ran.
export interface ToolResult {
  callId: string;
  name: string;
  output: unknown; // plain JSON
  isError: boolean;
}

// What every tool gets besides its own input: which conversation it runs in.
// escalateToHuman needs it to mark the conversation, getOrder to count
// failed lookups.
export interface ToolContext {
  conversationId: string;
}

// One "hand" of the agent. Each tool has two schemas on purpose:
// - `definition.parameters` is what the model sees: plain JSON Schema.
// - `input` (zod) is what we enforce before running: it also trims and
//   limits lengths, and gives `run` a typed input.
export interface AgentTool<Schema extends z.ZodType = z.ZodType> {
  definition: ToolDefinition;
  input: Schema;
  // The returned value is sent back to the model as JSON.
  run(input: z.infer<Schema>, context: ToolContext): Promise<unknown>;
}
