# Lotus Spa — Voice Agent (Tier 1)

Inbound voice agent. Cloudflare Workers + Durable Objects. STT + LLM + TTS on
Workers AI. Twilio carries the phone call. Answers ONLY from the knowledge base.

## Files
```
src/agent.ts          # agent + Worker entry. onTurn (streamText+tools), Aura
                      #   mulaw TTS, PII-redacted call log, Twilio route
src/system-prompt.ts  # scope-lock + security prompt, reads the KB
src/knowledge-base.ts  # EDIT THIS to change the spa
public/index.html      # browser test UI: live transcript + saved-log recap
wrangler.jsonc         # AI binding, DO+SQLite, static assets
package.json           # deps
tsconfig.json
```

## What works
- Caller asks spa questions → answered from KB only, refuses off-topic.
- Book: collects name + service + day + time, reads back, books on "yes",
  gives confirmation number.
- Check existing: gated behind phone + a verifier, returns one record or none.
- Logs: live transcript in browser; saved log in DO SQLite (phone redacted),
  read at /admin/log or the recap button.

## Run (local)
```bash
npm install
npx wrangler secret put DEEPGRAM_API_KEY    # paste Deepgram key
npm run dev                                 # http://localhost:8787
```

## Test 1 — browser (no phone)
Open localhost:8787 → Start Call → allow mic → talk:
"what are your hours", "book a Swedish massage Friday at 2", confirm.
End Call → View saved call log.

## Test 2 — real US Twilio number
```bash
npm run deploy
```
Twilio Console → your number → Voice → "A call comes in" →
Webhook (HTTP POST) → https://<worker>.workers.dev/twilio/incoming
Call it.

## Change the spa
Edit src/knowledge-base.ts only. Everything reads from it.

## Two lines to verify before first run (named from docs, not confirmed)
1. agent.ts TTS import: class is `DeepgramTTS` from `@cloudflare/voice-deepgram`
   with encoding "mulaw", sampleRate 8000. If the package names it differently,
   fix that one import/options. mulaw 8000 IS the correct Twilio format.
2. `this.sql\`...\`` — Agents SDK SQLite tagged template. If your version uses
   `this.ctx.storage.sql`, adjust the 3 log calls.
Everything else follows Cloudflare's voice-agent article directly.
```
