# Lotus Voice Agent — Technical Design & Product Strategy

**Author:** CTO (Claude) for the founder
**Date:** 2026-06-21
**Status:** Approved design → next step is implementation plan
**Audience:** You (founder), the first engineer you hire, and a technical investor.

---

## 0. How to read this document

This is two things at once:

1. **A buildable spec** for the next phase — the demo that makes "feels human & instant" true.
2. **A long-term product/architecture strategy** so every decision we make for the demo is one we won't have to throw away in production.

I've written it personally and opinionatedly, because that's what a CTO owes a founder. Where I'm making a bet, I say so. Where there's real risk, I flag it instead of hiding it. Read sections 1–8 to build the demo. Read sections 9–16 to understand how we stay alive in production. Read section 17 carefully — it's the answer to your "can I own a proprietary model that learns from every call?" question, and it's the part most likely to become your actual moat.

---

## 1. Context

We're building an AI voice receptionist for spas and salons in the US. A customer calls a business's phone number; our agent ("Lotus") answers, talks naturally, answers questions, and books appointments — so the business never loses a booking to a missed call. The market is real: **~69% of salon/spa customers have abandoned a booking because they couldn't reach a human** (CloudTalk, 2026). The space is also **crowded** — AgentZap (~$109/mo), Famulor, Qlient.ai, CloudTalk, OmniDimension are all shipping.

**The strategic truth that shapes this whole document:** voice quality is *not* a moat. Everyone buys the same STT/TTS/telephony. The defensible moats are (1) **deep integrations** into the booking system the business already uses, (2) **reliability and trust**, and (3) eventually **a data flywheel** — proprietary improvement from the conversations we handle (section 17). Pricing/ROI is a go-to-market wedge, not a moat.

### Constraints we're designing around
- **Solo, non-expert founder**, wants to learn, flexible on architecture.
- **Limited funds.** GCP credits available **until Sept 2026**. ~$200 Deepgram credits. A free DeepSeek key via OpenRouter. A paid Twilio number already provisioned.
- **Demo-first.** The immediate goal is a perfect demo that wins the first few clients, not a finished SaaS.

---

## 2. Decisions locked in (with reasoning)

These came out of the brainstorming session and are the foundation of everything below.

| # | Decision | Chosen | Why |
|---|----------|--------|-----|
| D1 | What the demo must prove | **"It feels human & instant"** | First clients say yes to a *wow*, not to a feature list. Naturalness + low latency + barge-in. Booking can be mocked. |
| D2 | Build approach | **Self-host an orchestrator** | Own the conversation layer (the future moat). No per-minute platform tax. Runs on GCP credits. |
| D3 | Framework | **LiveKit Agents (TypeScript)** | Browser demo and Twilio call run the **same code path** — closes the biggest gap in the current prototype. Stay in TS, reuse `scheduling.ts`. Self-hosts on GCP. |
| D4 | LLM (this build) | **Gemini 2.5 Flash, behind a provider-swappable interface** | Fast + cheap + **on GCP credits** (aligns with runway). The abstraction keeps OpenRouter/DeepSeek and others as fallbacks. We never hard-couple to one LLM. |

### Why NOT the alternatives (so we remember the reasoning later)
- **Not "fix the current hand-rolled stack":** the buffered TTS, non-streaming double-pass LLM, and manual audio plumbing cap how good it can ever feel, and it's plumbing we'd maintain forever instead of building product.
- **Not Gemini Live / speech-to-speech (yet):** lowest latency and most natural, but weaker tool/guardrail control and transcript precision. We'd likely re-architect for reliable bookings + the data flywheel. We keep it as a **future option** (section 18), not the foundation.
- **Not a managed platform (Vapi/Retell):** fastest demo, but per-minute fees erode margin and the orchestration — our potential moat — would live in someone else's box.
- **Not Pipecat:** great framework, but Python-only and you bring your own transport. LiveKit's unified browser+telephony and TS support fit us better.

---

## 3. Current prototype: assessment (what we keep, port, drop)

The existing code is more thoughtful than it looks. Honest grading:

**Keep (your real assets):**
- `src/scheduling.ts` — **the best code in the repo.** Pure, testable, no vendor coupling. Hours parsing, service durations, overlap detection, no-booking-in-the-past, natural-language day/time resolution. This becomes the body of our booking tools, nearly unchanged.
- `src/system-prompt.ts` — the 10-section voice-oriented structure is good practice. Adapt, don't rewrite.
- The *concept* of a per-connection config snapshot + a seam to a per-tenant store. Right instinct.

**Drop (it's plumbing, not product — LiveKit replaces all of it):**
- `src/server.ts` WebSocket + audio relay + hand-rolled turn buffering.
- `src/deepgram.ts` — specifically the **buffered `synthesize()`** that collects the entire audio before sending a byte (this is the #1 felt-latency bug).
- `src/client.tsx` AudioWorklet capture / `decodeAudioData` scheduling / barge-in flushing.

**Why dropping is correct:** these solve problems LiveKit already solves better (model-based turn detection, streamed TTS, WebRTC transport, barge-in). Maintaining them is pure liability. Deleting ~70% of the current code here is a feature, not a loss.

### Root-cause analysis of "it lags" (so we don't reintroduce it)
1. **Buffered TTS** (`deepgram.ts`): entire synthesis collected before playback → 1–2s of dead air per reply. ← biggest felt issue.
2. **Non-streaming, double-pass LLM** (`llm.ts`): waits for full completion, and a booking calls the model **twice** sequentially before any audio.
3. **Free DeepSeek on OpenRouter**: slowest possible LLM path — rate-limited, queued, no latency SLA. Optimizing the *cheapest* part of the stack at the cost of the *most expensive* currency (how human it feels).

**Principle going forward:** perceived latency = time from caller's last syllable to Lotus's first syllable. We optimize *time-to-first-audio*, not throughput. Everything streams and pipelines.

---

## 4. Target architecture

A single LiveKit Agent process runs a streaming pipeline. Browser and Twilio both join a LiveKit **room** as participants; the agent is just another participant that listens and speaks. This is why one codebase serves both.

```
   Browser (WebRTC) ─┐
                     ├──►  LiveKit room  ◄──►  Agent (Node/TS process)
   Twilio phone ─────┘      (media SFU)          │
   (SIP → LiveKit)                               │  VoicePipelineAgent:
                                                 │   Silero VAD + turn detector
                                                 │        │
                                                 │   Deepgram nova-3 STT (stream)
                                                 │        │
                                                 │   Gemini 2.5 Flash LLM (stream tokens)
                                                 │        │  ← function tools
                                                 │   Deepgram Aura-2 TTS (stream audio)
                                                 │        │
                                                 └────────┘
                                                          │
                              tools ──►  scheduling.ts (pure booking logic)
                                         tenant config ──► getTenantConfig(id)
```

**Token-level pipelining (the thing that makes it feel instant):** the LLM streams tokens → the framework chunks them into sentences → each finished sentence is sent to TTS immediately → audio streams back to the room while the LLM is *still generating the rest*. Lotus starts speaking the first sentence before she's "decided" the second.

---

## 5. Component design

Each unit has one purpose, a clear interface, and explicit dependencies. This is what lets us (and you) reason about and test pieces in isolation.

### 5.1 `agent/worker.ts` — the agent entrypoint
- **Does:** registers the LiveKit agent, wires VAD → STT → LLM → TTS, attaches tools, loads tenant config for the room, speaks the greeting.
- **Interface:** LiveKit's agent `JobContext` (room, participant).
- **Depends on:** LiveKit Agents SDK, the plugin instances (5.4), `getTenantConfig`, the tools (5.3).

### 5.2 `agent/tenant.ts` — tenant configuration
- **Does:** returns the config that drives the prompt and behavior for a given business.
- **Interface:** `getTenantConfig(tenantId: string): Promise<TenantConfig>`.
- **Now:** returns a single hardcoded tenant (Lotus Day Spa). **Later:** one DB query. The seam never changes.
- **Type:**
  ```ts
  interface TenantConfig {
    id: string;
    name: string; address: string; phone: string;
    services: string;   // later: structured Service[]
    hours: string;      // parsed by scheduling.ts
    voice: string;      // TTS voice id
    timezone: string;   // critical for "tomorrow"/"3pm" resolution
  }
  ```

### 5.3 `agent/tools.ts` — function tools (the booking brain)
- **Does:** exposes `check_availability` and `book_appointment` to the LLM; both delegate to `scheduling.ts`.
- **Interface:** LiveKit tool definitions (name, description, zod/JSON schema, handler).
- **Depends on:** `scheduling.ts` (unchanged logic), the per-room appointment store.
- **Guardrail by construction:** the model cannot fabricate a confirmation — a booking only exists if `scheduling.ts` validates it and returns a real `confirmationId`.

### 5.4 `agent/providers.ts` — swappable vendor plugins
- **Does:** constructs STT/LLM/TTS plugin instances from env config, behind a thin interface so any one can be swapped without touching the pipeline.
- **Why it matters:** vendor swap-ability is a core reason we chose cascaded over speech-to-speech. We honor it in code, not just in spirit.

### 5.5 `scheduling.ts` — booking logic (KEPT)
- **Does:** parse hours, resolve spoken day/time, validate against hours + existing bookings. Pure, no I/O.
- **Unchanged interface:** `parseHours`, `checkAvailability`, `resolveWhen`, `fmtClock`, `newConfirmationId`.

### 5.6 `agent/prompt.ts` — system prompt builder (ADAPTED from current)
- **Does:** renders the 10-section voice prompt from `TenantConfig`, injects current date/time **in the tenant's timezone**.
- **Change from current:** timezone-aware (current code uses server local time — a real bug for a US-wide product).

### 5.7 `web/` — browser demo client
- **Does:** join the LiveKit room from the browser, render live transcript + the bookings rail.
- **Change from current:** **all** AudioWorklet/decode/barge-in code is replaced by the LiveKit client SDK. The KB sidebar and bookings rail UI are kept.

---

## 6. Data flow & the latency budget

The demo lives or dies on this budget. Target: **caller stops talking → first audio back in ≤ ~500–800ms** (sub-500ms is the gold standard for "natural"; we aim for it and accept some slack on free/credit tiers).

| Stage | Budget | Notes |
|---|---:|---|
| End-of-turn detection (VAD + turn model) | ~150–300ms | LiveKit turn detector; tunable. The biggest "feels laggy / cuts me off" lever. |
| STT final transcript | ~100–200ms | Deepgram nova-3 streaming; partials already arriving. |
| LLM time-to-first-token | ~200–400ms | Gemini Flash. The free-DeepSeek path was the killer here. |
| Sentence chunk → TTS time-to-first-audio | ~40–150ms | Deepgram Aura-2 streaming now; Cartesia Sonic (~40ms) as upgrade. |
| Network/jitter buffer | ~50–100ms | WebRTC handles adaptively. |

**Key architectural win:** because we pipeline, the LLM's *total* generation time and the *full* TTS synthesis time are **hidden** behind playback of earlier sentences. We only pay time-to-*first*-audio, not time-to-complete.

---

## 7. Vendor stack & cost model

| Layer | Choice (now) | Upgrade path | Reasoning |
|---|---|---|---|
| Orchestration | LiveKit Agents (TS), self-hosted on GCP | LiveKit Cloud if scale demands | One code path for browser + Twilio; no per-minute tax |
| STT | Deepgram nova-3 (streaming) | Keep; or AssemblyAI/Inworld if accuracy/latency demands | Have credits, proven |
| Turn-taking | LiveKit turn detector + Silero VAD | Tune thresholds per deployment | Model-based > our hand-rolled buffering |
| LLM | Gemini 2.5 Flash (behind interface) | Flash-Lite for cost; bigger model for hard tenants; **our own model — section 17** | Fast, cheap, GCP credits |
| TTS | Deepgram Aura-2 (streaming) | **Cartesia Sonic (~40ms TTFA)** for best feel | Streaming is the felt-latency fix |

### Rough per-minute cost intuition (for pricing later)
In a cascaded voice call, **STT + TTS dominate**; the LLM is typically ~5–15% of cost. This is *why* chasing a free LLM was the wrong optimization. When we price clients, model cost ≈ (STT + TTS + telephony + a thin LLM slice) × minutes, then set price so the client's recovered bookings clearly exceed it. Track **cost-per-handled-call** as a first-class metric from day one.

---

## 8. Turn-taking & barge-in

This is the hardest part of voice UX and where the current code spent real effort. LiveKit gives us better primitives:

- **VAD (Silero):** detects speech vs silence.
- **Turn detector model:** decides whether the caller is *done* or just pausing to think — directly addresses your "she should wait patiently while I think" requirement, without the brittle `utterance_end_ms` tuning in the current code.
- **Barge-in:** when the caller speaks during playback, LiveKit cancels TTS playback and in-flight LLM generation automatically. We delete our manual interrupt/flush logic.

We will still **tune** endpointing per channel (phone audio differs from browser). That tuning is config, not code.

### 8.1 Patient turn-taking (explicit requirement)

A core UX requirement: **the agent must let the caller finish their thought.** People pause mid-sentence to recall a date, check their calendar, or think. Lotus must not interrupt or start processing a half-finished sentence.

How we achieve it:
- The **turn-detector model** (not just silence timers) classifies "still speaking / thinking" vs "done." This is far more reliable than the current code's fixed `utterance_end_ms` silence threshold, which would cut a slow speaker off.
- **Configurable patience:** a per-tenant minimum think-pause window so we can tune how long Lotus waits during natural pauses (longer for elderly/relaxed spa clientele, shorter for brisk callers).
- **Accumulate, then process:** partial transcripts accumulate; we only run the LLM turn once the caller is genuinely done — so we process the *complete* input, never a fragment.
- **Backchanneling (later option):** subtle "mm-hm" acknowledgements so the caller knows they're heard during longer pauses, without taking the turn.

This requirement also drives a reliability rule (section 12.2): a slow/paused caller must **never** trip a timeout that drops the call.

---

## 9. Multi-tenancy & the per-client knowledge base

**Now (demo):** single tenant, config in code, in-memory bookings.

**Production target:**
- `tenants` table: identity, hours, services (structured), voice, timezone, integration credentials (encrypted).
- **Knowledge base per tenant:** start as structured fields + freeform FAQ text injected into the prompt. Evolve to **retrieval (RAG)** when KBs get large: embed each tenant's docs/policies, retrieve the relevant chunk per turn. This keeps prompts small (token control, section 13) and answers grounded.
- **Routing:** the dialed Twilio number → tenant id. One agent codebase, N tenants, isolated config and data.

**Isolation is a security boundary, not just a feature** — see section 10.

---

## 10. Security & data protection

Voice calls carry PII (names, phone numbers, sometimes health-adjacent info for spa services). For US SMB clients, trust is a sales requirement, not a nice-to-have.

- **Tenant data isolation:** every query scoped by `tenant_id`; no shared mutable state across tenants (the current `sharedStore` is demo-only and must not survive into production).
- **Secrets:** all API keys in a secret manager (GCP Secret Manager), never in `.env` in production, never in client code. Integration credentials (Vagaro etc.) encrypted at rest.
- **PII handling:** define a data-retention policy early. Default: store transcripts only with purpose (the flywheel, section 17) and with tenant consent; redact obvious sensitive fields; allow per-tenant opt-out.
- **No PII to free/unpaid endpoints:** the free DeepSeek tier (and any unpaid tier) has unclear data-use terms. Production LLM calls go only to vendors with a business agreement / no-training guarantee (Gemini on GCP, etc.).
- **Transport:** WebRTC is encrypted (DTLS/SRTP); Twilio SIP over TLS. App APIs over HTTPS only.
- **Auth:** the tenant dashboard (KB editing) needs real auth before any external client touches it. Out of scope for the demo, **required** before client #1 self-serves.
- **Compliance posture:** we are not selling medical advice (prompt forbids diagnosis). Still, document a privacy policy and call-recording disclosure ("this call may be recorded") — **call-recording consent law varies by US state** (two-party consent states exist). This is a real legal item, flagged for early legal review.

---

## 11. Guardrails

### 11.0 Persona: consultative & honest, NOT a sales bot (explicit requirement)

This is a product principle, not just a prompt detail. Lotus is a **trusted, knowledgeable receptionist who acts in the caller's interest** — not a closer trying to maximize bookings. This is, deliberately, a differentiator: most competitors optimize for conversion, which makes their agents pushy and erodes trust. We optimize for trust, which is what actually wins repeat business for the spa (and word-of-mouth for us).

Concrete behaviors:
- **Knows the business cold.** Lotus answers from the tenant's complete, structured knowledge base — every service, full descriptions, durations, what each treatment is good for, contraindications, and exact pricing. (This is why the KB evolves from freeform text to **structured `Service[]` + RAG**, sections 5.2 and 9 — so detail is grounded, not improvised.)
- **No hallucination, ever.** If Lotus doesn't know something or the query is ambiguous, she says so plainly and offers a human follow-up — she never invents a price, a result, an availability, or a policy. Grounded facts only; when unsure, ask or defer.
- **No false promises.** Never guarantees outcomes ("this will cure your back pain," "you'll look 10 years younger"). Describes what a service *is* and what it's *typically for*, honestly.
- **Recommends in the customer's favor.** Matches suggestions to the caller's stated need, preference, and budget — including saying "you probably don't need the premium package for that" or "the 60-minute is plenty for what you're describing." Down-selling when honest is *correct* and builds the trust that drives loyalty.
- **No pressure.** Doesn't push add-ons, doesn't create false urgency, doesn't repeatedly try to close. Offers, then respects the answer.

How this is enforced (not just hoped for):
- The **system prompt** (5.6) encodes these as hard rules with examples of honest vs. pushy phrasing.
- **Grounding by construction:** facts come from the KB/RAG, not model memory (section 9, 13).
- The **eval harness** (section 16) includes adversarial cases: ambiguous queries, "will this definitely fix X?", upsell-pressure scenarios — to verify Lotus stays honest and consultative across prompt/model changes.

- **Booking integrity:** model can never invent an appointment or confirmation — only `scheduling.ts` validation produces one. (Already true by design.)
- **Scope control:** prompt restricts Lotus to this business; deflects politics/news/other-business questions.
- **No hallucinated facts:** answers about hours/prices/services come from tenant config/RAG, not model memory. As KB grows, prefer retrieval over stuffing the prompt.
- **Escalation path:** abusive caller or repeated failure → offer a human callback (capture number), don't loop forever.
- **Safety:** never diagnose medical symptoms; refer out.
- **Output hygiene for voice:** no markdown/lists/asterisks; numbers/dates/prices spoken naturally (kept from current prompt).
- **Eval harness (production):** a regression test suite of scripted conversations to catch prompt/model changes that break behavior — see section 17, this doubles as flywheel infrastructure.

### 11.1 Date & time intelligence (don't ask the caller what day a date is — explicit requirement)

**Bug observed in the current prototype:** caller says "book me for June 23rd" and the agent replies "okay, what day of the week is that?" That is the agent throwing away intelligence it already has — and it instantly breaks the illusion of competence.

The rule: **the agent always knows today's full date (and the tenant's timezone) and resolves any spoken date/time itself.** It never asks the caller to do calendar math.

- "June 23rd" → resolve the weekday, check it against hours, confirm naturally: *"June 23rd is a Tuesday — we're open 10 to 7 that day. What time works?"*
- "next Friday", "tomorrow", "the 23rd" → all resolved relative to the injected current date.
- Your `scheduling.ts` already resolves "June 9"-style dates (`resolveWhen` via `Date.parse`) and returns the weekday. The fix is two-fold: (1) the prompt explicitly states "you know today's date; never ask the caller what weekday a date falls on — compute it"; (2) the `check_availability` tool **returns the resolved weekday + open hours** so the model confirms conversationally instead of asking.
- Edge cases live in the tool, not the model: ambiguous/past dates → the tool returns a reason and the model asks a *specific* clarifying question ("this June 23rd, or next year's?"), never a dumb one.

This is the general principle you asked for: **the agent should be as sharp as a competent human receptionist and never act dumb about things it can trivially work out.**

---

## 12. Reliability, error handling & observability

- **Graceful degradation:** if STT/LLM/TTS errors mid-call, Lotus says a short fallback ("one moment") and we retry or fail soft, never silent dead air.
- **Vendor failover:** because providers are behind an interface (5.4), a primary outage can fall back to a secondary (e.g., Aura-2 → Cartesia). Implement after demo.
- **Observability from day one:** structured logs per call (tenant, duration, turns, tool calls, latencies per stage, errors). You cannot improve latency you don't measure. Track time-to-first-audio as a live metric.
- **Call recording + transcript capture:** the substrate for both debugging and the flywheel (section 17), gated by the data policy in section 10.

### 12.1 Call storage & recording (explicit requirement)

You asked specifically: *how do we store transcripts / notes / audio so every call is captured and we know how it went?* Here is the architecture. This is also the raw material for the data flywheel (section 17), so we design it once and reuse it.

**What we capture per call:**
| Artifact | Source | Stored in |
|---|---|---|
| **Audio recording** | LiveKit **Egress** (records the room) | Object storage (**GCS** — on your credits) |
| **Live transcript** | STT events (caller) + agent's own text (Lotus), with timestamps + speaker labels | Database (Postgres), JSON per call |
| **Call summary / notes** | An LLM pass over the transcript *after* the call ("what did the caller want, what happened, follow-ups") | Database, attached to the call record |
| **Structured metadata** | tenant id, caller number, start/end time, duration, turn count, tool calls, **outcome** (booked / inquiry / abandoned / escalated), per-stage latencies, errors | Database |

**Data model (Phase 1):**
```
calls(
  id, tenant_id, caller_id, started_at, ended_at, duration_s,
  outcome,            -- booked | inquiry | abandoned | escalated
  recording_url,      -- GCS path (nullable until egress completes)
  summary,            -- LLM-generated notes
  transcript jsonb,   -- [{ role, text, ts }]
  metrics jsonb,      -- latencies, turn count, tool calls, errors
  consent_recording boolean
)
```

**Flow:**
1. On call start: create a `calls` row (status open), start LiveKit Egress recording (if consent), open a transcript accumulator.
2. During the call: append each finalized turn (caller + Lotus) to the transcript buffer with timestamps.
3. On call end: finalize duration + outcome, run the summary LLM pass, write transcript + metrics, link the recording URL when Egress finishes (async webhook).
4. The bookings rail / future dashboard reads from `calls` — so the business can see "here's how every call went," listen to the audio, read the notes.

**Demo vs production:** for the Phase 0 demo we can keep this lightweight (transcript + summary to a local store/JSON, audio recording optional). The **schema and the capture points** go in now so production is a swap of the storage backend, not a rewrite.

**Governance (ties to section 10):** recording is **consent-gated** and region-aware (two-party-consent states need an explicit "this call may be recorded" disclosure); retention policy + per-tenant opt-out; audio in GCS with lifecycle rules; PII handled per policy. We store with *purpose* (the flywheel + giving the business call insight), not indiscriminately.

### 12.2 Never-fail-mid-call (robust supervisory loops — explicit requirement)

You said the call must **not fail mid-conversation** and we need "proper functioning AI loops" in production. A live phone call is the worst place to crash — the caller is a real person who will hang up and not call back. Reliability rules:

- **Turn-level isolation:** every turn runs in a try/catch. A failed tool call, a malformed LLM response, or a transient STT/TTS hiccup recovers *within the call* — Lotus says a brief, graceful "sorry, could you say that once more?" and continues. **One bad turn never tears down the session.**
- **Per-stage timeouts + retry-with-backoff:** each vendor call (STT/LLM/TTS) has a timeout and a bounded retry. On exhaustion → graceful spoken fallback, not a dropped call.
- **Supervisory loop:** the agent process supervises each session; if a component throws, the supervisor catches it, logs it, keeps the room alive, and continues. The session ends only when the *caller* ends it (or a hard safety cap — max call duration, section 14).
- **No timeout on patient pauses:** thinking pauses (section 8.1) must never count as a failure or trigger a hangup. Endpointing and liveness checks are separate concerns.
- **Health checks + auto-restart:** the agent worker has liveness/readiness checks; the orchestrator restarts a crashed worker, and in-flight calls degrade gracefully rather than vanishing.
- **Graceful vendor failover (Phase 2):** because providers sit behind one interface (5.4), a primary outage falls back to a secondary mid-call where feasible.
- **Everything observable:** every caught error is logged with call id + tenant + stage, so "how did this call fail" is always answerable (feeds 12.1 metrics).

### 12.3 Call lifecycle & connection management (auto-end, silence, inaudible — explicit requirement)

A human receptionist ends the call when the business is done — they don't sit silently holding the line. Lotus must do the same, for UX *and* for **token/connection cost** (an idle open call burns money and a connection slot).

- **Graceful auto-end:** when the caller's need is met and they signal completion ("that's all, thanks"), Lotus gives a warm farewell and **calls `end_call` herself** — she does not wait for the caller to hang up. The prompt teaches her to detect end-of-conversation and close without being abrupt.
- **Silence / no-response watchdog:** if the caller goes quiet after Lotus's turn, wait a patient window, then re-prompt once ("Are you still there?"). Still nothing after a second window → close gracefully ("I'll let you go for now — call back anytime!") and end. Tunable timeouts; never an infinite open line.
- **Inaudible / low-quality audio:** if STT returns empty/low-confidence repeatedly, Lotus says "I'm having trouble hearing you — could you repeat that?" Bounded retries (e.g., 2). If it keeps failing, offer a callback or end gracefully rather than looping forever.
- **Hard caps:** max call duration and max consecutive failed turns (section 14) as backstops against stuck/abusive sessions.
- **Thinking ≠ disconnection:** a patient *thinking* pause (8.1) is NOT silence-to-hang-up. Watchdog timers are longer than think-pause windows and only escalate after a re-prompt.

Net effect: calls end when they should, connections free up, tokens aren't burned on dead air, and edge cases (hold-forever, no-response, can't-hear) are handled maturely — retry, then exit.

---

## 13. Token management ("token maxing") & cost control

You asked specifically about this. Concrete levers:

- **Keep prompts lean:** the 10-section prompt is fine for one tenant, but don't let KBs balloon the system prompt. Move large/rarely-used knowledge to **RAG** so only the relevant chunk enters the context per turn.
- **Bound conversation history:** voice calls are short, but cap history (e.g., last N turns or a token budget) and **summarize** older turns if a call runs long. Prevents cost and latency creep within a call.
- **Right-size the model per task:** Flash-Lite for simple Q&A turns, a stronger model only when a turn is hard. (Possible later via a small router.)
- **Cap output length:** voice replies are 1–2 sentences — enforce a low `max_tokens`. Faster *and* cheaper.
- **Prompt caching:** cache the static system-prompt prefix where the provider supports it, so the per-turn cost is mostly the dynamic suffix.
- **Measure cost-per-call** per tenant; alert on anomalies (a misbehaving prompt can 10x cost silently).

### 13.1 Response & FAQ caching (faster + cheaper — explicit requirement)

You asked how to cache FAQs ("do you have discounts?", "list all your services") for faster responses. We layer three kinds of caching, cheapest-to-build first:

1. **Exact / templated FAQ answers (build first).** A small set of common questions per tenant have *deterministic* answers derived from the KB (services list, prices, hours, discounts, address/parking). Precompute the spoken answer text — and even **pre-synthesize the TTS audio** — so a hit plays back **instantly**: zero LLM, zero TTS latency. These change only when the tenant edits the KB, so regenerate on KB save.
2. **Semantic cache (build second).** Embed the caller's question and match against cached question embeddings; above a similarity threshold, return the cached answer. Catches paraphrases — "any deals right now?" hits the same entry as "do you have discounts?". Self-hosted semantic caches answer in ~50ms vs. seconds for a full LLM run, with ~60–70% hit rates on clustered support queries. Per-tenant namespace.
3. **Provider prompt caching (always-on).** Cache the static system-prompt prefix at the LLM provider so each turn pays mostly for the dynamic suffix — up to ~85% lower latency and ~90% lower input-token cost on the cached portion.

**Plus a warm-up trick:** fire a tiny throwaway LLM request during the greeting so the model is "warm" before the caller's first real question (kills first-token cold start).

**Correctness guardrail:** only cache *stable* answers (services, prices, hours, policies). **Never** cache time- or caller-specific things (availability, bookings, "what's open at 3pm today") — a stale availability answer is worse than a slow one. Invalidation is keyed to KB edits.

---

## 14. Rate limiting & abuse protection

- **Per-tenant concurrency caps:** max simultaneous calls per tenant (protects cost and fairness).
- **Per-number throttling:** detect a single number hammering the line (robo/abuse) and throttle or drop.
- **Global spend guardrail:** a hard daily/monthly spend ceiling per tenant and platform-wide — a runaway loop or attack must not drain GCP credits or rack up Deepgram/Twilio bills. Alarm + auto-cutoff.
- **Provider rate limits:** respect upstream STT/LLM/TTS limits; queue/backoff gracefully; surface as "high call volume, please hold" rather than crashing.
- **Max call duration:** cap call length to bound cost of stuck/abusive sessions.

---

## 15. Telephony (Twilio) path

- Twilio number → **SIP trunk into LiveKit** → the call becomes a room participant → the *same agent code* handles it. This is the structural payoff of choosing LiveKit.
- Phone audio is narrowband (8kHz) and noisier than browser; we tune VAD/endpointing and pick a TTS voice that holds up on phone.
- **Demo order:** browser first (fast iteration), then flip on the Twilio/SIP path with no agent rewrite.

---

## 16. Testing & evaluation (recursive, improve-every-result — explicit requirement)

You asked for proper testing across many use cases, improving recursively, and specifically *how to measure with an eval suite*. Here's the methodology.

### 16.1 Layers of testing
- **Unit:** `scheduling.ts` stays pure → fast unit tests (hours parsing, overlaps, past-time, **date→weekday resolution**, timezone). Highest-value; keep the spirit of the existing `test-ai*.ts`.
- **Tool handlers:** test `check_availability` / `book_appointment` against `scheduling.ts` with a fixed `now`.
- **Conversation evals:** scripted multi-turn scenarios run against the agent (below).
- **Manual call checklist:** quick human pass in the browser before each demo.

### 16.2 How the eval suite works ("how to measure")
1. **Scenario = a script of caller turns + assertions.** e.g. *Booking happy-path*: "deep tissue next Friday at 3pm" → assert a booking with the right service/date + a read-back confirmation. *Honesty*: "will this cure my sciatica?" → assert NO guaranteed-outcome language. *Patience*: caller pauses mid-sentence → assert no interruption. *Date intelligence*: "June 23rd" → assert the agent states the weekday itself and never asks the caller. *Graceful-end*: "that's all" → assert the agent ends the call. *Inaudible*: garbled input → assert retry-then-exit.
2. **Run the script against the agent.** For logic evals, drive the LLM/tools with text turns (fast, cheap, deterministic with a fixed clock). For full realism (later), use a **simulated caller** (a second LLM voicing the script) over the audio pipeline.
3. **Score each run with assertions + an LLM-as-judge.** Deterministic checks (booking created? right date?) plus a judge model rating subjective qualities (honest? natural? concise?) on a rubric. Metrics: **task-success rate, hallucination rate, interruption rate, time-to-first-audio, turn count, graceful-end rate.**
4. **Track scores over time.** A results table per run; a change ships only if it doesn't regress the suite.

### 16.3 The recursive loop (the part you care about)
**Every real-world failure becomes a permanent test.** When a call goes wrong (dumb date question, pushy upsell, dropped call): (a) capture the transcript, (b) turn it into a new eval scenario, (c) fix the prompt/logic, (d) re-run the *whole* suite to confirm the fix **and no regression**. The suite only grows; the agent can never re-break something it already learned. This is also the on-ramp to the data flywheel (section 17) — the same capture→eval→improve loop, automated as volume grows.

**Tooling:** start with a lightweight custom runner (Node test + an LLM-judge call). Graduate to a voice-eval platform (Coval / Hamming-style) when call volume justifies it.

---

## 17. The proprietary model & the data flywheel (your "model that learns from every call")

You asked: *can I own my own proprietary model that learns from all clients' customer conversations and keeps improving with every call?*

**Short answer: yes — but not by training an LLM from scratch.** Training a competitive base model costs millions and is not your business. What you *can* own — and what becomes a genuine moat competitors can't copy — is the **data flywheel**: the accumulated, labeled, outcome-tagged conversation data and the systems that turn it into a measurably better agent over time. The model is a component; **the data + the improvement loop is the moat.**

Here's the honest, phased path from "uses someone's LLM" to "owns proprietary improvement":

### Phase A — Capture (start in production immediately, gated by section 10 consent)
Record every call: audio, transcript, tool calls, outcome (booked? abandoned? escalated?), and per-stage latency. **This is the raw material. You can't build a flywheel on data you didn't keep.** Storing it from day one (with consent + retention policy) is the single most important long-term decision in this document.

### Phase B — Learn *without* training (weeks, cheap, high ROI)
You get most of the "it keeps getting better" benefit before ever fine-tuning a model:
- **RAG / memory:** mine successful calls for the best answers and objection handling; feed them back as retrieved context. The agent "remembers" what worked.
- **Prompt improvement from data:** find where calls fail (abandons, escalations, repeated clarifications) and fix the prompt/flow. Measure with the eval suite.
- **Few-shot from winners:** inject your best real exchanges as examples.
- **Per-tenant memory:** returning-caller context, business-specific phrasing.
This phase makes the product visibly improve call-over-call **using a third-party LLM**, which is exactly the experience you described — and it's the right first step regardless.

### Phase C — Fine-tune a small open model (when data volume justifies it)
Once you have enough high-quality labeled conversations (typically thousands of good calls):
- **Fine-tune a small open model** (e.g., a Llama/Qwen/Gemma-class model) on *your* conversations to match your tone, your booking flow, your objection handling — and to run **cheaper and faster** than a general API model for your narrow task. A small specialized model often beats a big general one on a narrow domain, at a fraction of the cost/latency.
- This is where "proprietary model" becomes literally true: **you own the weights**, trained on data only you have.
- **Distillation:** use a strong model (Gemini/Claude) as a teacher to label/generate training data for your smaller student model — a cheap way to bootstrap quality.

### Phase D — Continuous improvement loop (the actual flywheel)
- New calls → outcomes labeled (auto + light human review) → periodic re-training/eval → deploy if the eval suite improves → repeat.
- **Guardrail:** never auto-deploy a model that hasn't beaten the current one on the eval suite. "Learns automatically" must mean "improves measurably," never "drifts silently." This is why the eval harness (sections 11, 16) is flywheel-critical, not optional.

### Honest caveats (CTO duty)
- **Data rights:** training on customer-call data requires the right consent and contracts with your *business* clients (whose customers are on the calls). Get this right early — it's both legal and a trust differentiator. Per-tenant opt-out; consider keeping tenant data logically separate even in training.
- **It's a Phase 2+ investment.** Do **not** build C/D now. Build **A immediately** (capture + consent), do **B** as you get traffic. C/D come when data volume and revenue justify the MLOps cost.
- **The moat is the loop, not the model.** A competitor can fine-tune the same open model; they can't replicate your accumulated, outcome-labeled, domain-specific conversation dataset and the eval-gated improvement system around it.

---

## 18. Production roadmap (phased)

**Phase 0 — Demo (this build).** LiveKit agent (TS), Deepgram STT/TTS, Gemini Flash, `scheduling.ts` tools, mock bookings, browser client, single tenant. Bar: feels human & instant. Then flip on Twilio.

**Phase 1 — First real clients.** Per-tenant config in a DB, **admin/analytics dashboard** (section 23) with auth, **Google Calendar event creation as the first booking integration** (chosen — simplest reliable write target; CRM/booking-platform integrations like Vagaro/Boulevard follow), call recording + consent + retention, observability + spend guardrails, basic rate limiting.

**Phase 2 — Scale & hardening.** More integrations (each is moat), vendor failover, RAG knowledge bases, cost-per-call dashboards, eval harness, SOC2-readiness posture.

**Phase 3 — Data flywheel & proprietary model.** Section 17 Phases B→C→D. This is where margin and moat compound.

**Future option:** evaluate speech-to-speech (Gemini Live / OpenAI Realtime) for an even more natural feel once tool/guardrail control on S2S matures, or run a hybrid.

---

## 19. TODO (immediately actionable, ordered)

These are the concrete next steps; the detailed implementation plan (next skill) will expand them.

- [ ] Scaffold a LiveKit Agents (TS) project; get a token + room working locally.
- [ ] Stand up the `VoicePipelineAgent`: Silero VAD + turn detector + Deepgram STT + Gemini Flash + Deepgram Aura-2, all streaming.
- [ ] Port `system-prompt.ts` → `agent/prompt.ts`, timezone-aware, with the **consultative-honesty persona** (11.0): grounded-facts-only, no false promises, customer-favor recommendations, no pressure — include honest-vs-pushy phrasing examples.
- [ ] Structure the KB toward `Service[]` (name, description, what it's for, duration, price) so detailed, grounded answers are possible — not freeform text the model paraphrases.
- [ ] Wrap `scheduling.ts` as `check_availability` + `book_appointment` tools.
- [ ] `getTenantConfig()` returning the single Lotus tenant (seam for DB later).
- [ ] Browser client on the LiveKit client SDK; keep KB sidebar + bookings rail UI.
- [ ] Tune turn detection so Lotus waits through thinking pauses but doesn't lag (8.1: patient endpointing, process complete input only).
- [ ] Wrap each turn in try/catch with graceful spoken fallback + a session supervisor so one bad turn never drops the call (12.2).
- [ ] Capture per call: transcript (timestamped) + post-call LLM summary + outcome, written to a `calls` store (lightweight for demo, schema per 12.1); wire audio recording (LiveKit Egress → GCS) behind a consent flag.
- [ ] Measure time-to-first-audio; iterate to target.
- [ ] **Date intelligence (11.1):** prompt + `check_availability` resolve "June 23rd" → weekday themselves; agent never asks the caller what day a date is. Add eval cases.
- [ ] **Graceful auto-end + watchdogs (12.3):** `end_call` on completion; silence re-prompt-then-exit; inaudible retry-then-exit; hard caps.
- [ ] **Spoken consent at call start:** "this call may be recorded" before capture begins.
- [ ] **FAQ/exact-answer cache (13.1):** precompute services/prices/hours/discount answers per tenant (text now; pre-synth TTS audio next). Semantic cache after.
- [ ] **LLM warm-up** during greeting to kill first-token cold start.
- [ ] **Eval suite (16):** scenario runner + LLM-judge; seed with happy-path, honesty, patience, date-intelligence, graceful-end, inaudible scenarios; wire the recursive failure→test loop.
- [ ] Manual demo checklist (greeting, barge-in, pause, book, decline, out-of-scope, error, auto-end).
- [ ] **(Deferred) Twilio SIP → LiveKit** — only after the browser experience is mastered.
- [ ] Decide LLM env: Gemini Flash primary, OpenRouter/DeepSeek fallback wired behind `providers.ts`.

---

## 20. Out of scope for this build (YAGNI — architected toward, built later)

Real booking-system integrations, multi-tenant DB, dashboard auth/billing, SMS reminders, analytics dashboard, vendor failover, RAG, fine-tuning/flywheel, speech-to-speech. We design seams toward all of these and build **none** of them now. The demo's only job is: **feels human & instant.**

---

## 21. Resolved decisions (founder answers, 2026-06-21)

1. **LLM data terms:** ✅ Default production traffic to **Gemini on GCP**; DeepSeek for local dev only.
2. **First integration:** ✅ **Google Calendar event creation** — simplest reliable write target for the first real bookings; booking-platform integrations (Vagaro/Boulevard/Mindbody) follow.
3. **Consent:** ✅ Speak a **recording-consent warning at the start of every call**, before capture begins.
4. **Timeline:** ✅ Build now. **Master the browser experience first**; Twilio deferred.

---

## 22. Lessons from production voice agents (research, 2026)

Distilled from current practitioner write-ups so we avoid mistakes others already paid for:

- **The 200–300ms instinct, ~800ms tolerance, ~1.5s "it broke" cliff.** Humans expect a turn under ~800ms; past ~1.5s they assume failure. Every turn must hit first-audio within that.
- **Misconfigured VAD/endpointing is the #1 silent latency killer** — it can add 500ms with no model change. Too eager → interrupts; too slow → dead air. Hence a model-based turn detector, tuned per channel (8.1).
- **The waterfall architecture is the classic mistake** — wait-for-full-STT → wait-for-full-LLM → wait-for-full-TTS. We stream and overlap every stage (4, 6). This is exactly the trap the current prototype fell into (buffered `synthesize()`).
- **Real audio is messy.** Models tuned on clean studio audio fail on noisy lobbies, cars, and accents. Use robust STT + echo cancellation; test on realistic audio, not a silent room.
- **Most "AI" failures are scoping/data problems** (Gartner 2026: 57% unrealistic expectations, 38% poor data quality) that surface as engineering problems months later. Antidotes: tight demo scope, structured grounded KB (no hallucination), capture-from-day-one.
- **Cold start is real:** warm the LLM during the greeting (13.1).
- **Don't optimize the cheapest component:** chasing a free LLM while it adds latency is the wrong trade (the original DeepSeek-free mistake).

Sources: [Voice AI latency (Quiq)](https://quiq.com/blog/voice-ai-latency/), [Latency: fast/slow/fix (Hamming)](https://hamming.ai/resources/voice-ai-latency-whats-fast-whats-slow-how-to-fix-it), [The voice AI stack (AssemblyAI)](https://www.assemblyai.com/blog/the-voice-ai-stack-for-building-agents), [Why voice agents fail (Appinventiv)](https://appinventiv.com/blog/why-ai-voice-agents-fail/), [Sub-300ms architecture (Prodinit)](https://www.prodinit.com/blog/production-voice-ai-agents-latency-architecture), [Semantic caching (Redis)](https://redis.io/blog/prompt-caching-vs-semantic-caching/), [LLM caching (AWS)](https://aws.amazon.com/blogs/database/optimize-llm-response-costs-and-latency-with-effective-caching/).

---

## 23. Admin dashboard & analytics (explicit requirement)

You want a per-business admin view: what callers ask, the weird requests, regular callers, and the metrics that improve the agent for the next caller. Built on the `calls` table (12.1) — capture first, visualize second.

**Metrics & views (per tenant):**
- **Top intents / FAQs:** cluster transcripts by intent (embeddings) → "30% ask about discounts, 22% ask service duration." Directly drives the FAQ cache (13.1) and KB.
- **Weird / out-of-scope / failed requests:** outliers and escalated/low-confidence calls — the queue of things to teach the agent next (feeds the recursive eval loop, 16.3).
- **Regular callers:** group by caller number → frequency, last visit, usual service → enables per-caller personalization later (17 Phase B).
- **Outcomes funnel:** booked / inquiry / abandoned / escalated, and **where** abandons happen (which turn) — the most actionable improvement signal.
- **Operational health:** avg time-to-first-audio, call duration, retry/inaudible rate, cost-per-call, peak times, concurrency.
- **Booking conversion** and estimated **revenue recovered** (your ROI pitch, quantified).

**Architecture:** `calls` + a derived `call_insights` table (intent label, embedding, flags) computed by a post-call job; a simple authenticated web dashboard reads aggregates. Phase 1 (after the browser demo is solid). The KB-editing sidebar in the demo is the seed of this dashboard.

---

## 24. Changelog / running learnings

A living log so this doc stays the source of truth as we build.

- **2026-06-21 — Initial design.** LiveKit Agents (TS), Deepgram STT/TTS, Gemini Flash, kept `scheduling.ts`; demo bar = "feels human & instant"; data-flywheel strategy (17).
- **2026-06-21 — Requirements round 2.** Added consultative-honesty persona (11.0), patient turn-taking (8.1), call storage + recording (12.1), never-fail supervisory loops (12.2).
- **2026-06-21 — Requirements round 3 + research.** Added date/time intelligence fix (11.1, the "what day is June 23rd" bug); graceful auto-end + silence/inaudible watchdogs + connection/token management (12.3); FAQ/semantic/prompt caching + warm-up (13.1); recursive eval methodology (16); admin dashboard & analytics (23); production lessons from research (22). Resolved founder decisions (21): Gemini on GCP, Google Calendar first integration, spoken consent at call start, build-now browser-first.
- **2026-06-21 — Phase 0 implementation plan written** → `docs/superpowers/plans/2026-06-21-livekit-voice-agent-phase0.md`. 11 tasks, browser-first LiveKit demo; pure logic (scheduling/tools/prompt/FAQ/call-store/evals) fully TDD'd, LiveKit wiring verified by running the demo. Founder commits manually after local testing.
- **2026-06-21 — Task 1 done + API reality.** Installed `@livekit/agents@1.4.8` (+ deepgram/google/livekit/silero plugins, livekit-server-sdk, livekit-client, vitest; 256 pkgs). Verified surface: `llm.tool` (fn), `voice.Agent/AgentSession`, `deepgram.STT/TTS`, `google.LLM`, event `conversation_item_added` all present. **Deprecations:** standalone silero VAD plugin + text-based turnDetector plugin are deprecated — `AgentSession` now bundles VAD + native turn detection via `@livekit/local-inference@0.2.5` (omit `vad`/`turnDetection`). Plan Task 9 simplified accordingly; fixed `'../src/scheduling.js'`→`'../scheduling.js'` import bug. tsconfig already ES2022 + skipLibCheck (clean `tsc`).
- **2026-06-21 — Tasks 2–8 done (pure logic, TDD).** `scheduling.ts` date-intelligence fix (`weekdayName` + resolved weekday/open/close on success); `tenant.ts` single-tenant Lotus config + `servicesAsText`; `prompt.ts` persona/honesty/date-intelligence builder with tz-injected today; `tools.ts` rich-result handlers (`runAvailability`/`runBooking`) + `llm.tool` wrappers (`checkAvailability`/`bookAppointment`/`endCall`); `faq-cache.ts` keyword exact-answer cache; `call-store.ts` in-memory transcript+outcome store; `providers.ts` STT/LLM/TTS vendor seam. 13/13 unit tests green, `tsc` clean.
- **2026-06-21 — Task 9 done (streaming worker).** `worker.ts` wires `AgentSession` (Deepgram STT → Gemini Flash → Aura-2 TTS, bundled VAD/turn-detection), greeting+spoken consent via `generateReply`, transcript capture via `conversation_item_added`, graceful auto-end timer. Type-checks against the real v1.4.8 API.
- **2026-06-21 — Tasks 10–11 done (browser client + evals).** `server/token.ts` Express token mint on :3001; `vite.config.ts` proxy repointed `/api`→:3001 and dead `/ws` relay removed. `client.tsx` rewritten onto `livekit-client` (deletes ~150 lines of hand-rolled WebSocket/AudioWorklet PCM plumbing): 3-column shell, read-only KB sidebar, live transcript via `RoomEvent.TranscriptionReceived` (upsert-by-segment-id), agent audio via `TrackSubscribed`→`attach`, and a live bookings rail fed by `RoomEvent.DataReceived` on the `'booking'` topic — `worker.ts` `onBooking` now publishes each confirmation via `localParticipant.publishData`. Task 11: `eval/scenarios.ts` (5 seed scenarios) + thin `eval/run-evals.ts` runner (judge wiring deferred to Phase 1) + `tests/eval-scenarios.test.ts` deterministic guards. **Full suite 16/16 green, `tsc` clean.** Remaining: Task 10 Step 5 — founder's live 4-terminal demo (needs real Deepgram/Gemini keys + `livekit-server` binary + mic).
- *(Next entries: build learnings as tasks complete.)*
