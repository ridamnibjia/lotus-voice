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

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { searchParams } = new URL(context.request.url);
  const model = searchParams.get('model') === 'deepseek' ? 'deepseek' : 'gemini';
  // Unique room per session so concurrent public testers don't share a call.
  const room = `lotus-demo__${model}__${crypto.randomUUID()}`;

  const at = new AccessToken(
    context.env.LIVEKIT_API_KEY,
    context.env.LIVEKIT_API_SECRET,
    { identity: `web-${Date.now()}` },
  );
  at.addGrant({ roomJoin: true, room, canPublish: true, canSubscribe: true });

  return new Response(
    JSON.stringify({ token: await at.toJwt(), url: context.env.LIVEKIT_URL, room }),
    { headers: { 'content-type': 'application/json' } },
  );
};
