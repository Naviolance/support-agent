import type { ConfigService } from '@nestjs/config';
import type { GoogleGenAI } from '@google/genai';
import type { ToolDefinition } from '../tools/tool.js';
import {
  DEFAULT_GEMINI_MODEL,
  GeminiModelClient,
} from './gemini-model-client.js';

function setup(response: unknown, model?: string) {
  const generateContent = vi.fn().mockResolvedValue(response);
  const ai = { models: { generateContent } } as unknown as GoogleGenAI;
  const config = { get: () => model } as unknown as ConfigService;
  return { client: new GeminiModelClient(ai, config), generateContent };
}

const tool: ToolDefinition = {
  name: 'searchProducts',
  description: 'Search parts',
  parameters: {
    type: 'object',
    properties: { query: { type: 'string' } },
    required: ['query'],
    additionalProperties: false,
  },
};

const toolCallResponse = {
  candidates: [
    {
      finishReason: 'STOP',
      content: {
        role: 'model',
        parts: [
          {
            functionCall: {
              id: 'call_1',
              name: 'searchProducts',
              args: { query: 'brake pad' },
            },
            thoughtSignature: 'c2lnbmF0dXJl',
          },
        ],
      },
    },
  ],
  usageMetadata: {
    promptTokenCount: 500,
    candidatesTokenCount: 40,
    thoughtsTokenCount: 100,
  },
};

describe('GeminiModelClient', () => {
  it('sends the history, system prompt and tools as JSON Schema', async () => {
    const { client, generateContent } = setup(toolCallResponse);
    const history = [client.userMessage('Do you have brake pads?')];

    await client.generate({ system: 'Be helpful', history, tools: [tool] });

    expect(generateContent).toHaveBeenCalledWith({
      model: DEFAULT_GEMINI_MODEL,
      contents: [
        { role: 'user', parts: [{ text: 'Do you have brake pads?' }] },
      ],
      config: {
        systemInstruction: 'Be helpful',
        tools: [
          {
            functionDeclarations: [
              {
                name: 'searchProducts',
                description: 'Search parts',
                parametersJsonSchema: tool.parameters,
              },
            ],
          },
        ],
      },
    });
  });

  it('uses GEMINI_MODEL when set', async () => {
    const { client, generateContent } = setup(toolCallResponse, 'gemini-x');
    await client.generate({ system: '', history: [], tools: [] });
    expect(generateContent.mock.calls[0][0].model).toBe('gemini-x');
  });

  it('reads tool calls and keeps the message exactly as received', async () => {
    const { client } = setup(toolCallResponse);

    const turn = await client.generate({ system: '', history: [], tools: [] });

    expect(turn.toolCalls).toEqual([
      { id: 'call_1', name: 'searchProducts', input: { query: 'brake pad' } },
    ]);
    expect(turn.text).toBe('');
    expect(turn.finished).toBe(true);
    // The thought signature survives, so it can be sent back next time.
    expect(turn.message).toBe(toolCallResponse.candidates[0].content);
    // Thinking tokens count as output.
    expect(turn.usage).toEqual({ inputTokens: 500, outputTokens: 140 });
  });

  it('returns the answer text without the thought summaries', async () => {
    const { client } = setup({
      candidates: [
        {
          finishReason: 'STOP',
          content: {
            role: 'model',
            parts: [
              { text: 'Checking stock...', thought: true },
              { text: 'Yes, we have them ' },
              { text: 'for 15000 FCFA.' },
            ],
          },
        },
      ],
    });

    const turn = await client.generate({ system: '', history: [], tools: [] });

    expect(turn.text).toBe('Yes, we have them for 15000 FCFA.');
    expect(turn.toolCalls).toEqual([]);
  });

  it('marks a turn cut off by the safety filter as unfinished', async () => {
    const { client } = setup({
      candidates: [
        {
          finishReason: 'SAFETY',
          content: { role: 'model', parts: [{ text: 'Partial' }] },
        },
      ],
    });

    const turn = await client.generate({ system: '', history: [], tools: [] });

    expect(turn.finished).toBe(false);
    expect(turn.stopReason).toBe('SAFETY');
  });

  it('throws when the request is refused with no answer at all', async () => {
    const { client } = setup({
      candidates: [],
      promptFeedback: { blockReason: 'PROHIBITED_CONTENT' },
    });

    await expect(
      client.generate({ system: '', history: [], tools: [] }),
    ).rejects.toThrow('PROHIBITED_CONTENT');
  });

  it('sends all tool results in one message, errors under "error"', () => {
    const { client } = setup(toolCallResponse);

    expect(
      client.toolResultsMessage([
        {
          callId: 'call_1',
          name: 'searchProducts',
          output: { products: [] },
          isError: false,
        },
        {
          callId: 'call_2',
          name: 'getOrder',
          output: { error: 'Invalid input' },
          isError: true,
        },
      ]),
    ).toEqual({
      role: 'user',
      parts: [
        {
          functionResponse: {
            id: 'call_1',
            name: 'searchProducts',
            response: { output: { products: [] } },
          },
        },
        {
          functionResponse: {
            id: 'call_2',
            name: 'getOrder',
            response: { error: { error: 'Invalid input' } },
          },
        },
      ],
    });
  });
});
