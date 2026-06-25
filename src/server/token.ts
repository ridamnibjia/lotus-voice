/**
 * token.ts
 * Tiny Express server that mints LiveKit access tokens for the browser client.
 * The browser hits /api/token (proxied by Vite), joins the room; the agent
 * worker auto-joins the same room as a participant.
 */
import express from 'express';
import { AccessToken } from 'livekit-server-sdk';
import dotenv from 'dotenv';
dotenv.config();

const app = express();

app.get('/api/token', async (req, res) => {
  // Model choice rides in the room name so the agent worker (which only shares a
  // room with the browser) can read it in `entry` — no race, always present.
  const model = req.query.model === 'deepseek' ? 'deepseek' : 'gemini';
  // Unique room per session so concurrent testers don't land in the same call.
  const room = `lotus-demo__${model}__${crypto.randomUUID()}`;
  const at = new AccessToken(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, {
    identity: `web-${Date.now()}`,
  });
  at.addGrant({ roomJoin: true, room, canPublish: true, canSubscribe: true });
  res.json({ token: await at.toJwt(), url: process.env.LIVEKIT_URL, room });
});

app.listen(3001, () => console.log('token server on http://localhost:3001'));
