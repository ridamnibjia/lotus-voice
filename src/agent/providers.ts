/**
 * providers.ts
 * The ONLY place model vendors are chosen. Swap here, not in the pipeline.
 * Verified against @livekit/agents@1.4.8: deepgram.STT/TTS, google.LLM,
 * openai.LLM (OpenAI-compatible — used here for OpenRouter) all exist.
 */
import * as deepgram from '@livekit/agents-plugin-deepgram';
import * as google from '@livekit/agents-plugin-google';
import * as openai from '@livekit/agents-plugin-openai';
import { ThinkingLevel } from '@google/genai';

export type ModelChoice = 'gemini' | 'deepseek';
export const DEFAULT_MODEL: ModelChoice = 'gemini';

export function makeSTT() {
  return new deepgram.STT({ model: 'nova-3', language: 'en-US' });
}

export function makeLLM(model: ModelChoice = DEFAULT_MODEL) {
  if (model === 'deepseek') {
    // DeepSeek V4 via OpenRouter (OpenAI wire-compatible). Slug is env-overridable
    // since OpenRouter renames models; default is the current V4 chat slug.
    return new openai.LLM({
      model: process.env.OPENROUTER_MODEL ?? 'deepseek/deepseek-v4-flash',
      apiKey: process.env.OPENROUTER_API_KEY,
      baseURL: 'https://openrouter.ai/api/v1',
      temperature: 0.4,
    });
  }
  // Gemini 3.x controls reasoning with `thinkingLevel` (an enum), NOT the
  // Gemini-2.5-only `thinkingBudget` (a token count) — passing the latter to a
  // 3.x model errors out before any audio. MINIMAL = least thinking = lowest
  // voice latency, while still avoiding the empty-text/thoughtSignature chunks
  // that can trip the LiveKit streaming parser.
  return new google.LLM({
    model: 'gemini-3.1-flash-lite',
    temperature: 0.4,
    thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
  });
}

export function makeTTS(voice: string) {
  return new deepgram.TTS({ model: voice }); // e.g. 'aura-2-thalia-en'
}
