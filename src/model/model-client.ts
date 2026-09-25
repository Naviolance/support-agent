import type { ToolCall, ToolDefinition, ToolResult } from '../tools/tool.js';

// The agent loop talks to the AI model only through this interface. One
// class implements it per provider (GeminiModelClient today), and it is the
// only code that knows that provider's request and response format.
//
// Messages are "provider-native": each one is stored in the messages table
// exactly as the provider sent or expects it, and sent back unchanged on the
// next request. The loop never looks inside them. This matters for Gemini,
// whose replies carry thought signatures that must be returned untouched.
export type ProviderMessage = unknown;

export interface ModelRequest {
  system: string;
  history: ProviderMessage[];
  tools: ToolDefinition[];
}

export interface ModelTurn {
  message: ProviderMessage; // the model's reply, to store and replay
  text: string; // '' when the model only asked for tools
  toolCalls: ToolCall[];
  // false when the model stopped for another reason than finishing its
  // answer (hit the length limit, safety filter...). Its text can't be
  // trusted as a complete reply then.
  finished: boolean;
  stopReason: string;
  usage: { inputTokens: number; outputTokens: number };
}

export interface ModelClient {
  userMessage(text: string): ProviderMessage;
  toolResultsMessage(results: ToolResult[]): ProviderMessage;
  generate(request: ModelRequest): Promise<ModelTurn>;
}

// Injection token: the agent asks for "the model client", and the module
// decides which provider that is.
export const MODEL_CLIENT = Symbol('MODEL_CLIENT');
