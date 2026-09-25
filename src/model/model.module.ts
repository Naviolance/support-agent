import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI } from '@google/genai';
import { GEMINI_SDK, GeminiModelClient } from './gemini-model-client.js';
import { MODEL_CLIENT } from './model-client.js';

// Picks the AI provider. To switch to another one, write its ModelClient and
// change `useClass` here; nothing else in the app changes.
@Module({
  providers: [
    {
      provide: GEMINI_SDK,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new GoogleGenAI({
          apiKey: config.getOrThrow<string>('GEMINI_API_KEY'),
          // Without retryOptions the SDK does not retry at all, and a
          // momentary "model overloaded" (503) would hand the conversation to
          // a human. 4 attempts, waiting about 1s, 2s, then 4s: at worst the
          // customer waits ~10 seconds more.
          // 429 (quota) is left out on purpose: the free tier's limit is per
          // day, so retrying seconds later cannot succeed and only burns
          // more attempts.
          httpOptions: {
            retryOptions: {
              attempts: 4,
              initialDelay: 1,
              maxDelay: 8,
              httpStatusCodes: [408, 500, 502, 503, 504],
            },
          },
        }),
    },
    { provide: MODEL_CLIENT, useClass: GeminiModelClient },
  ],
  exports: [MODEL_CLIENT],
})
export class ModelModule {}
