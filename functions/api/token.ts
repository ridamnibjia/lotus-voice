/**
 * Cloudflare Pages Function — GET /api/token
 * Production twin of src/server/token.ts. Pages serves this on the same origin
 * as the static frontend, so the browser's fetch("/api/token?model=...") works
 * unchanged (no proxy, no CORS). Requires nodejs_compat (see wrangler.jsonc) and
 * LIVEKIT_* secrets set via `wrangler pages secret put`.
 */
import { AccessToken } from 'livekit-server-sdk';

interface Env {
  LIVEKIT_URL: string;
  LIVEKIT_API_KEY: string;
  LIVEKIT_API_SECRET: string;
}

// Minimal context type — avoids depending on @cloudflare/workers-types just for
// the `PagesFunction` global. Cloudflare Pages calls onRequestGet with this shape.
export const onRequestGet = async (
  context: { request: Request; env: Env },
): Promise<Response> => {
  const { searchParams } = new URL(context.request.url);
  const model = searchParams.get('model') === 'deepseek' ? 'deepseek' : 'gemini';
  // Unique room per session so concurrent public testers don't share a call.
  const room = `lotus-demo__${model}__${crypto.randomUUID()}`;

  // Edited KB rides as participant metadata (JSON). The worker reads it via
  // waitForParticipant() and grounds the agent in it. Validate it parses and cap
  // its size so a junk/oversized param can't bloat the token.
  let metadata: string | undefined;
  const kb = searchParams.get('kb');
  if (kb && kb.length < 4000) {
    try { JSON.parse(kb); metadata = kb; } catch { /* ignore bad KB, use defaults */ }
  }

  const at = new AccessToken(
    context.env.LIVEKIT_API_KEY,
    context.env.LIVEKIT_API_SECRET,
    { identity: `web-${Date.now()}`, metadata },
  );
  at.addGrant({ roomJoin: true, room, canPublish: true, canSubscribe: true });

  return new Response(
    JSON.stringify({ token: await at.toJwt(), url: context.env.LIVEKIT_URL, room }),
    { headers: { 'content-type': 'application/json' } },
  );
};
