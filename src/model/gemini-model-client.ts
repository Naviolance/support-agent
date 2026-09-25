import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FinishReason, type Content, type GoogleGenAI } from '@google/genai';
import type { ToolResult } from '../tools/tool.js';
import type { ModelClient, ModelRequest, ModelTurn } from './model-client.js';

export const GEMINI_SDK = Symbol('GEMINI_SDK');
export const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash';

// Translates between the agent's format and Gemini's generateContent API.
// Stateless: every request carries the whole conversation from our database,
// so Google keeps nothing between calls.
@Injectable()
export class GeminiModelClient implements ModelClient {
  private readonly model: string;

  constructor(
    @Inject(GEMINI_SDK) private readonly ai: GoogleGenAI,
    config: ConfigService,
  ) {
    this.model = config.get<string>('GEMINI_MODEL') || DEFAULT_GEMINI_MODEL;
  }

  userMessage(text: string): Content {
    return { role: 'user', parts: [{ text }] };
  }

  // All results of one turn go back in a single message, matched to their
  // call by id.
  toolResultsMessage(results: ToolResult[]): Content {
    return {
      role: 'user',
      parts: results.map((result) => ({
        functionResponse: {
          ...(result.callId && { id: result.callId }),
          name: result.name,
          // Gemini's convention: the value under "output", or "error" when
          // the call failed.
          response: result.isError
            ? { error: result.output }
            : { output: result.output },
        },
      })),
    };
  }

  async generate({ system, history, tools }: ModelRequest): Promise<ModelTurn> {
    const response = await this.ai.models.generateContent({
      model: this.model,
      contents: history as Content[],
      config: {
        systemInstruction: system,
        tools: [
          {
            functionDeclarations: tools.map((tool) => ({
              name: tool.name,
              description: tool.description,
              parametersJsonSchema: tool.parameters,
            })),
          },
        ],
      },
    });

    const candidate = response.candidates?.[0];
    if (!candidate?.content) {
      // The request itself was refused (e.g. blocked by a safety filter).
      // There is no reply to store, so this is an error for the loop.
      throw new Error(
        `Gemini returned no answer (${response.promptFeedback?.blockReason ?? 'no candidate'})`,
      );
    }

    const parts = candidate.content.parts ?? [];
    const usage = response.usageMetadata;
    return {
      // Stored exactly as received: this keeps the thought signatures that
      // Gemini requires back on the next request.
      message: candidate.content,
      text: parts
        .filter((part) => part.text && !part.thought)
        .map((part) => part.text)
        .join('')
        .trim(),
      toolCalls: parts
        .filter((part) => part.functionCall)
        .map((part) => ({
          // Gemini 3 always sends an id. Older models may not, and then the
          // result is matched by name only.
          id: part.functionCall!.id ?? '',
          name: part.functionCall!.name ?? '',
          input: part.functionCall!.args ?? {},
        })),
      finished:
        candidate.finishReason === undefined ||
        candidate.finishReason === FinishReason.STOP,
      stopReason: candidate.finishReason ?? 'STOP',
      usage: {
        inputTokens: usage?.promptTokenCount ?? 0,
        // Thinking tokens are billed as output on paid tiers.
        outputTokens:
          (usage?.candidatesTokenCount ?? 0) + (usage?.thoughtsTokenCount ?? 0),
      },
    };
  }
}
