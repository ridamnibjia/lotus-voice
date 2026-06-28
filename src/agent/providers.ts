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
  //
  // Vertex vs AI Studio: prod (GCP worker) sets GOOGLE_GENAI_USE_VERTEXAI=true
  // so Gemini bills to GCP Cloud Billing (the trial credits). Local dev leaves
  // it unset and falls back to the GOOGLE_API_KEY (AI Studio) path. The plugin
  // also reads these envs itself; passing them here just pins a region default
  // and keeps the model-vendor choice readable in one file.
  // ponytail: location must be a REGION (us-west1), not a zone (us-west1-a).
  const useVertex = process.env.GOOGLE_GENAI_USE_VERTEXAI === 'true';
  return new google.LLM({
    model: 'gemini-3.1-flash-lite',
    temperature: 0.4,
    thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
    ...(useVertex && {
      vertexai: true,
      project: process.env.GOOGLE_CLOUD_PROJECT,
      location: process.env.GOOGLE_CLOUD_LOCATION ?? 'us-west1',
    }),
  });
}

export function makeTTS(voice: string) {
  return new deepgram.TTS({ model: voice }); // e.g. 'aura-2-thalia-en'
}
