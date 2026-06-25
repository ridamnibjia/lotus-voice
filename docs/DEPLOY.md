# Deploy — Lotus Voice Agent

Three runtime pieces, three homes. They meet only in a LiveKit room.

| Piece | Code | Runs on | Why |
|---|---|---|---|
| Frontend (SPA) | `src/client.tsx` → `dist/` | Cloudflare Pages | Static |
| Token minter | `functions/api/token.ts` | Cloudflare Pages Function | Stateless, per-request |
| Agent worker | `src/agent/worker.ts` | DO droplet / GCP VM / container | Persistent process + native binaries |
| LiveKit SFU | — | **LiveKit Cloud** | Free TURN + TLS; don't self-host |

```
   Cloudflare Pages              LiveKit Cloud            Droplet / container
  ┌─────────────────┐          ┌──────────────┐         ┌──────────────┐
  │ frontend (dist) │          │   room       │  dials  │ agent worker │
  │ /api/token ─JWT▶│          │  lotus-demo  │◀──out───│              │
  └───────▲─────────┘          └──────▲───────┘         └──────────────┘
          │ open URL                  │ browser joins (WebRTC)
          └───────── browser ─────────┘
```

The model toggle travels browser → worker via the **room name**:
`lotus-demo__<model>__<uuid>` (unique per session so concurrent testers don't
collide). The worker reads segment 1 to pick Gemini vs DeepSeek.

---

## 1. LiveKit Cloud (the backbone)

1. livekit.io → create a project.
2. Settings → Keys → copy: `LIVEKIT_URL` (`wss://xxx.livekit.cloud`),
   `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`.

These same three are used by **both** the worker and the token function. That
shared identity is what links the browser and the worker. Mismatch = the agent
never joins.

## 2. Agent worker

Needs `LIVEKIT_*`, `DEEPGRAM_API_KEY`, `GOOGLE_API_KEY`, `OPENROUTER_API_KEY`.

### Option A — DO droplet + pm2

```bash
# Node 20
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
. ~/.nvm/nvm.sh && nvm install 20

git clone <repo> voice-agent && cd voice-agent
npm install
cp .env.example .env && nano .env      # fill all keys

npm install -g pm2
pm2 start npm --name agent -- run agent:start
pm2 save && pm2 startup                  # run the printed command
pm2 logs agent                           # expect: registered worker
```

Droplet <1GB RAM → add swap (`local-inference` loads a VAD model):
```bash
fallocate -l 1G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
```

### Option B — Docker (any host)

```bash
# Apple Silicon needs --platform; Linux x64 host can drop it.
docker build --platform linux/amd64 -t lotus-agent .
docker run -d --restart unless-stopped --env-file .env --name agent lotus-agent
docker logs -f agent
```

## 3. Frontend + token → Cloudflare Pages

### Via dashboard (recommended)
Pages → Create → connect the Git repo:
- Build command: `npm run build`
- Output directory: `dist`
- Env vars (Production), key/secret **encrypted**:
  `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`

### Via CLI
```bash
npm run build
npx wrangler pages deploy
npx wrangler pages secret put LIVEKIT_URL
npx wrangler pages secret put LIVEKIT_API_KEY
npx wrangler pages secret put LIVEKIT_API_SECRET
```

Result: `https://lotus-voice-agent.pages.dev` — the public test link.

## 4. Verify

1. Open the Pages URL, allow mic.
2. Toggle Gemini / DeepSeek → Start.
3. `pm2 logs agent` (or `docker logs agent`) → `[agent] using LLM: <model>`.
4. Talk → hear the agent. Switch model, start again, confirm the log changes.

---

## Local dev (no cloud)

```bash
cp .env.example .env        # dev LiveKit creds already set; add vendor keys
brew install livekit        # livekit-server CLI
# 4 terminals:
npm run livekit             # local SFU :7880
npm run token-server        # :3001
npm run agent               # worker (dev/hot-reload)
npm run dev                 # UI :5173
```
Open http://localhost:5173.

## Notes

- **DeepSeek slug**: default `deepseek/deepseek-v4-flash` (low latency). Override
  with `OPENROUTER_MODEL=deepseek/deepseek-v4-pro` for quality.
- **Open token endpoint**: anyone with the URL can mint a token. Fine for a demo;
  unique-per-session rooms stop cross-talk. Add a rate limit / auth before any
  real launch.
