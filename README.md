# Lotus — Voice Agent (Phase 0 browser demo)

Inbound voice receptionist for a spa ("Lotus"). Streaming **LiveKit Agents**
pipeline: Deepgram STT → Gemini LLM → Deepgram Aura-2 TTS, with bundled VAD +
native turn detection. Browser joins a LiveKit room; the agent answers, books
appointments via validated logic, and ends calls gracefully.

Design + plan: `docs/superpowers/specs/` and `docs/superpowers/plans/`.

## Files
```
src/agent/worker.ts     # agent entrypoint: wires AgentSession, greeting+consent, capture
src/agent/providers.ts  # the ONLY place STT/LLM/TTS vendors are chosen (swap seam)
src/agent/prompt.ts     # system prompt: persona, honesty, date-intelligence, tz-aware date
src/agent/tools.ts      # llm.tool defs: checkAvailability / bookAppointment / endCall
src/agent/tenant.ts     # TenantConfig + getTenantConfig (single tenant now; DB seam later)
src/agent/faq-cache.ts  # precomputed exact-answer FAQ cache from tenant config
src/agent/call-store.ts # in-memory transcript + outcome store (flywheel substrate)
src/scheduling.ts       # pure booking logic (hours, date resolution, overlap checks)
src/server/token.ts     # Express endpoint that mints LiveKit room tokens
src/client.tsx          # browser client on livekit-client: transcript + bookings rail
src/eval/               # scenario seeds + deterministic eval guards
tests/                  # vitest unit tests for the pure-logic modules
```

## Models
Chosen in `src/agent/providers.ts`:
- **LLM:** `gemini-3.1-flash-lite` (Gemini 3.x → `thinkingLevel`, not `thinkingBudget`).
- **STT:** Deepgram `nova-3`. **TTS:** Deepgram Aura-2 (`tenant.voice`).

## Setup
```bash
npm install
brew install livekit          # one-time: local media server binary
cp .env.example .env           # then fill DEEPGRAM_API_KEY + GOOGLE_API_KEY
```
`.env` keys: `LIVEKIT_URL/API_KEY/API_SECRET` (dev defaults work), `DEEPGRAM_API_KEY`, `GOOGLE_API_KEY`.

## Run the demo (4 terminals)
```bash
npm run livekit        # 1. local LiveKit media server (:7880)
npm run agent          # 2. Lotus worker
npm run token-server   # 3. token mint (:3001)
npm run dev            # 4. Vite browser client
```
Open the printed localhost URL → **Start Browser Call** → allow mic → talk:
"what are your hours", "book a deep tissue on June 23rd at 3pm", "that's all thanks".

## Test
```bash
npm test               # vitest: scheduling, tools, prompt, faq, call-store, evals
```

## Change the spa
Edit `src/agent/tenant.ts` (the single `LOTUS` config). Everything reads from it.

## Out of scope (Phase 1+)
Twilio/SIP, real DB, Google Calendar booking, audio recording (Egress), RAG,
vendor failover. Seams exist; none built yet. See spec §18/§20.
