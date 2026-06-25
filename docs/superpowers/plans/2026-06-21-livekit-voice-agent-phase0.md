# Lotus Voice Agent — Phase 0 (Browser Demo) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A browser-based voice demo where "Lotus" (a spa receptionist) answers, talks naturally with sub-~800ms response and barge-in, knows the business honestly, books appointments via validated logic, ends calls gracefully, and records each call — built on LiveKit Agents (TypeScript).

**Architecture:** A LiveKit Agent worker runs a streaming `AgentSession` (Deepgram STT → Gemini Flash LLM → Deepgram Aura-2 TTS, with Silero VAD + turn detector). The browser joins a LiveKit room via the `livekit-client` SDK; a tiny Express endpoint mints room tokens. Pure booking logic (`scheduling.ts`) is exposed to the LLM as function tools. All conversation/feel logic streams and pipelines so we only pay time-to-first-audio.

**Tech Stack:** Node ≥ 20, TypeScript, `@livekit/agents` (+ plugins: silero, deepgram, google), `livekit-server-sdk` (tokens), `livekit-client` (browser), `livekit-server --dev` (local media server), React + Vite (existing), `vitest` (tests), `zod`.

## Global Constraints

- **Git commits: the founder runs ALL commits manually after local testing. Executors MUST NOT run `git commit`/`git add`/`git push`.** Each task ends with a **Checkpoint** (build/test/run), not a commit.
- **Demo scope only:** single tenant, mock/in-memory bookings, browser-only. NO Twilio, NO real DB, NO Google Calendar yet (those are Phase 1 — see spec §18, §20).
- **LLM:** Gemini 2.5 Flash via the Google plugin, behind a provider seam (`providers.ts`). DeepSeek/OpenRouter stays only as a documented fallback.
- **Latency rule:** everything streams; never buffer a full LLM completion or full TTS before output (spec §6, §22).
- **Honesty rule:** the agent answers only from tenant config/KB; never invents prices/results/availability; recommends in the customer's favor (spec §11.0).
- **Date intelligence rule:** the agent resolves dates itself and never asks the caller what weekday a date is (spec §11.1).
- **Verify version-sensitive API:** LiveKit plugin import paths/class names evolve. Where a task says "verify against installed version," run the noted check before trusting the snippet.
- **Spec is source of truth:** `docs/superpowers/specs/2026-06-21-livekit-voice-agent-design.md`. Update its §24 changelog as tasks complete.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/scheduling.ts` | (KEEP + fix) pure booking logic; now returns resolved weekday + open/close hours |
| `src/agent/tenant.ts` | `TenantConfig` type + `getTenantConfig()` (single tenant now; DB seam later) |
| `src/agent/prompt.ts` | builds the system prompt (persona, honesty, date-intelligence, timezone-aware date) |
| `src/agent/tools.ts` | `llm.tool()` defs: `checkAvailability`, `bookAppointment`, `endCall` → delegate to `scheduling.ts` |
| `src/agent/faq-cache.ts` | precomputed exact-answer FAQ cache built from tenant config |
| `src/agent/call-store.ts` | in-memory `calls` store: transcript accumulator + outcome + summary shape |
| `src/agent/lifecycle.ts` | silence/inaudible watchdog config + helpers for graceful end |
| `src/agent/providers.ts` | constructs STT/LLM/TTS plugin instances from env (the swap seam) |
| `src/agent/worker.ts` | LiveKit agent entrypoint: wires Agent + AgentSession, greeting+consent, capture |
| `src/server/token.ts` | Express server: serves the SPA + mints LiveKit access tokens for the browser |
| `src/client.tsx` | (REWRITE) browser client on `livekit-client`; transcript UI, KB sidebar, bookings rail |
| `tests/*.test.ts` | vitest unit tests for the pure-logic modules + eval scenarios |
| `src/eval/run-evals.ts` | scenario runner + LLM-judge for the recursive eval loop (spec §16) |
| `.env` | LIVEKIT_URL/API_KEY/API_SECRET, DEEPGRAM_API_KEY, GOOGLE_API_KEY |

**Files to delete (replaced by LiveKit):** old `src/server.ts` (WS relay), old `src/deepgram.ts` (buffered synth), old `src/llm.ts` (manual two-pass loop), old `src/client.tsx` audio plumbing, `test-ai*.ts`. Delete in Task 1.

---

## Task 1: Project scaffold + LiveKit dev server boots

**Files:**
- Modify: `package.json` (deps + scripts)
- Create: `.env.example`
- Create: `src/agent/worker.ts` (minimal boot)
- Delete: `src/server.ts`, `src/deepgram.ts`, `src/llm.ts`, `test-ai.ts`, `test-ai-history.ts`
- Create: `tsconfig.json` adjustments if needed

**Interfaces:**
- Produces: a runnable agent worker (`npm run agent`) that registers with a local LiveKit server.

- [ ] **Step 1: Remove dead plumbing**

```bash
rm -f src/server.ts src/deepgram.ts src/llm.ts test-ai.ts test-ai-history.ts
```

- [ ] **Step 2: Install dependencies**

```bash
npm install @livekit/agents @livekit/agents-plugin-silero @livekit/agents-plugin-deepgram @livekit/agents-plugin-google @livekit/agents-plugin-livekit livekit-server-sdk livekit-client
npm install -D vitest
```

Then verify the installed agents version and its README example surface (the API in this plan matches `@livekit/agents` v1.x `voice.AgentSession`):

```bash
npm ls @livekit/agents
node -e "console.log(Object.keys(require('@livekit/agents')))"
```
Expected: output includes `voice`, `llm`, `cli`, `defineAgent`, `WorkerOptions`, `inference`.

- [ ] **Step 3: Add scripts to `package.json`**

```json
"scripts": {
  "dev": "vite",
  "token-server": "tsx src/server/token.ts",
  "agent": "tsx src/agent/worker.ts dev",
  "livekit": "livekit-server --dev",
  "test": "vitest run",
  "test:watch": "vitest",
  "build": "vite build"
}
```

- [ ] **Step 4: Create `.env.example`**

```bash
# Local LiveKit dev server uses these fixed dev credentials:
LIVEKIT_URL=ws://localhost:7880
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=secret
# Vendor keys
DEEPGRAM_API_KEY=your_deepgram_key
GOOGLE_API_KEY=your_gemini_key
```

Copy it: `cp .env.example .env` and fill real Deepgram + Gemini keys. (`livekit-server --dev` accepts `devkey`/`secret` automatically.)

- [ ] **Step 5: Minimal worker that boots**

Create `src/agent/worker.ts`:

```typescript
import { WorkerOptions, cli, defineAgent, type JobContext } from '@livekit/agents';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
dotenv.config();

export default defineAgent({
  entry: async (ctx: JobContext) => {
    await ctx.connect();
    console.log('[agent] connected to room:', ctx.room.name);
  },
});

cli.runApp(new WorkerOptions({ agent: fileURLToPath(import.meta.url) }));
```

- [ ] **Step 6: Install the LiveKit server binary (one-time)**

macOS: `brew install livekit` (or download from livekit.io/install). Verify: `livekit-server --version`.

- [ ] **Step 7: Checkpoint — boot the stack**

Terminal A: `npm run livekit` → expect `starting LiveKit server` on `:7880`.
Terminal B: `npm run agent` → expect `registered worker` log (worker connects to ws://localhost:7880).
This proves the toolchain + credentials work before we add the pipeline.

---

## Task 2: Fix date intelligence in `scheduling.ts` (TDD)

**Why:** the "June 23rd → what day is that?" bug. The tool must return the resolved weekday + open/close so the agent confirms instead of asking (spec §11.1).

**Files:**
- Modify: `src/scheduling.ts` (extend `SlotCheck` ok-result with `weekdayName`, `openMin`, `closeMin`)
- Create: `tests/scheduling.test.ts`

**Interfaces:**
- Produces: `checkAvailability(...)` returning, on success, `{ ok: true, resolved, durationMin, endMin, weekdayName: string, openMin: number, closeMin: number }`. `fmtClock(min)` and a new `weekdayName(weekday: number): string` helper.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/scheduling.test.ts
import { describe, it, expect } from 'vitest';
import { parseHours, checkAvailability, weekdayName } from '../src/scheduling.js';

const HOURS = parseHours('Mon-Wed: 10am-7pm, Thu-Fri: 10am-8pm, Sat: 9am-6pm, Sun: 11am-4pm');

describe('date intelligence', () => {
  it('resolves a spoken calendar date to its weekday without asking the caller', () => {
    // 2026-06-21 is a Sunday; June 23rd 2026 is a Tuesday.
    const now = new Date('2026-06-21T12:00:00');
    const r = checkAvailability({ service: 'Swedish Massage', day: 'June 23', time: '3 PM' }, HOURS, [], now);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.weekdayName).toBe('Tuesday');
      expect(r.openMin).toBe(10 * 60);
      expect(r.closeMin).toBe(19 * 60);
    }
  });

  it('weekdayName maps 0..6 to Sunday..Saturday', () => {
    expect(weekdayName(0)).toBe('Sunday');
    expect(weekdayName(2)).toBe('Tuesday');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/scheduling.test.ts`
Expected: FAIL — `weekdayName` not exported / `weekdayName`/`openMin`/`closeMin` undefined on result.

- [ ] **Step 3: Implement minimal additions in `src/scheduling.ts`**

Add the helper and widen the success result:

```typescript
const WEEKDAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
export function weekdayName(weekday: number): string {
  return WEEKDAYS[((weekday % 7) + 7) % 7];
}
```

Change the `SlotCheck` ok branch type to:

```typescript
export type SlotCheck =
  | { ok: true; resolved: ResolvedWhen; durationMin: number; endMin: number;
      weekdayName: string; openMin: number; closeMin: number }
  | { ok: false; reason: string };
```

And in `checkAvailability`, in the final `return { ok: true, ... }`, include the new fields:

```typescript
return {
  ok: true, resolved, durationMin, endMin,
  weekdayName: weekdayName(resolved.weekday),
  openMin: dayHours.open, closeMin: dayHours.close,
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/scheduling.test.ts`
Expected: PASS (both tests).

- [ ] **Step 5: Add regression tests for existing behavior**

Append to `tests/scheduling.test.ts`:

```typescript
describe('availability guards', () => {
  it('rejects a closed day', () => {
    const now = new Date('2026-06-21T12:00:00'); // June 22 2026 is Monday(open); pick a closed-time instead
    const r = checkAvailability({ service: 'Facial', day: 'June 23', time: '9 PM' }, HOURS, [], now);
    expect(r.ok).toBe(false);
  });
  it('rejects a past time today', () => {
    const now = new Date('2026-06-22T15:00:00'); // Monday 3pm
    const r = checkAvailability({ service: 'Facial', day: 'today', time: '10 AM' }, HOURS, [], now);
    expect(r.ok).toBe(false);
  });
});
```

- [ ] **Step 6: Run + Checkpoint**

Run: `npx vitest run tests/scheduling.test.ts` → Expected: PASS (all). Founder reviews diff.

---

## Task 3: Tenant config + structured services (TDD)

**Files:**
- Create: `src/agent/tenant.ts`
- Create: `tests/tenant.test.ts`

**Interfaces:**
- Produces: `interface Service { name; description; goodFor; durationMin; price }`, `interface TenantConfig { id; name; address; phone; timezone; voice; hours; services: Service[] }`, `getTenantConfig(id: string): Promise<TenantConfig>`, `servicesAsText(t: TenantConfig): string`.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/tenant.test.ts
import { describe, it, expect } from 'vitest';
import { getTenantConfig, servicesAsText } from '../src/agent/tenant.js';

describe('tenant config', () => {
  it('returns the Lotus tenant with structured services', async () => {
    const t = await getTenantConfig('lotus');
    expect(t.name).toBe('Lotus Day Spa');
    expect(t.timezone).toBe('America/Los_Angeles');
    expect(t.services.length).toBeGreaterThan(0);
    expect(t.services[0]).toHaveProperty('price');
  });
  it('renders services as ear-friendly text with prices', async () => {
    const t = await getTenantConfig('lotus');
    const txt = servicesAsText(t);
    expect(txt).toMatch(/Swedish/);
    expect(txt).toMatch(/\$120|one hundred twenty/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tenant.test.ts` → Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/agent/tenant.ts`**

```typescript
export interface Service {
  name: string;
  description: string;   // honest description of what it is
  goodFor: string;       // what it typically helps with (no guarantees)
  durationMin: number;
  price: number;
}

export interface TenantConfig {
  id: string;
  name: string;
  address: string;
  phone: string;
  timezone: string;      // IANA tz, critical for date resolution
  voice: string;         // TTS voice id
  hours: string;         // parsed by scheduling.parseHours
  services: Service[];
}

const LOTUS: TenantConfig = {
  id: 'lotus',
  name: 'Lotus Day Spa',
  address: '1847 Fillmore Street, San Francisco, CA 94115',
  phone: '(415) 555-0142',
  timezone: 'America/Los_Angeles',
  voice: 'aura-2-thalia-en',
  hours: 'Mon-Wed: 10am-7pm, Thu-Fri: 10am-8pm, Sat: 9am-6pm, Sun: 11am-4pm',
  services: [
    { name: 'Swedish Massage', description: 'A gentle full-body massage using long, flowing strokes.', goodFor: 'general relaxation and easing mild tension', durationMin: 60, price: 120 },
    { name: 'Deep Tissue Massage', description: 'Firm pressure targeting deeper muscle layers.', goodFor: 'chronic tightness and knots', durationMin: 90, price: 140 },
    { name: 'Facial', description: 'A cleansing and hydrating skin treatment.', goodFor: 'refreshing and nourishing the skin', durationMin: 60, price: 150 },
  ],
};

// Single-tenant for the demo. Seam for a per-tenant DB later.
export async function getTenantConfig(_id: string): Promise<TenantConfig> {
  return LOTUS;
}

export function servicesAsText(t: TenantConfig): string {
  return t.services
    .map((s) => `${s.name} ($${s.price}, ${s.durationMin} minutes) — ${s.description} Good for ${s.goodFor}.`)
    .join(' ');
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/tenant.test.ts` → Expected: PASS.

- [ ] **Step 5: Checkpoint** — founder reviews the structured KB shape (this is what makes grounded, honest answers possible).

---

## Task 4: System prompt builder — persona, honesty, date intelligence (TDD)

**Files:**
- Create: `src/agent/prompt.ts`
- Create: `tests/prompt.test.ts`

**Interfaces:**
- Consumes: `TenantConfig`, `servicesAsText` (Task 3).
- Produces: `buildSystemPrompt(t: TenantConfig, now: Date): string`.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/prompt.test.ts
import { describe, it, expect } from 'vitest';
import { buildSystemPrompt } from '../src/agent/prompt.js';
import { getTenantConfig } from '../src/agent/tenant.js';

describe('system prompt', () => {
  it('encodes honesty, no-false-promises, and date-intelligence rules and injects today in tenant tz', async () => {
    const t = await getTenantConfig('lotus');
    const p = buildSystemPrompt(t, new Date('2026-06-21T19:00:00Z'));
    expect(p).toMatch(/never.*guarantee|no.*promise/i);            // no false promises
    expect(p).toMatch(/never ask.*what (day|weekday)/i);           // date intelligence
    expect(p).toMatch(/in the caller's (favou?r|interest)/i);      // consultative
    expect(p).toMatch(/Swedish Massage/);                          // grounded KB present
    expect(p).toMatch(/2026/);                                     // today's date injected
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/prompt.test.ts` → Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/agent/prompt.ts`**

```typescript
import type { TenantConfig } from './tenant.js';
import { servicesAsText } from './tenant.js';

export function buildSystemPrompt(t: TenantConfig, now: Date): string {
  const dateStr = now.toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: t.timezone,
  });
  const timeStr = now.toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', timeZone: t.timezone, timeZoneName: 'short',
  });

  return `
### Role
You are Lotus, the warm, efficient receptionist for ${t.name}. You help callers learn about services and book appointments. A great call leaves the caller helped and trusting us — a booking is good, an honest "here's what fits you" is just as good.

### Personality
Warm, calm, professional — a real spa voice. Match the caller's pace. Never rushed, never fawning, never salesy.

### Honesty (non-negotiable)
- Answer ONLY from the knowledge base below. If you don't know something or a request is unclear, say so plainly and offer a human follow-up. NEVER invent a price, result, availability, or policy.
- NEVER make false promises or guarantee outcomes (e.g. "this will cure your pain"). Describe what a service is and what it's typically good for, honestly.
- Recommend in the caller's favor and interest — including suggesting a smaller/cheaper option when it genuinely fits ("the 60-minute is plenty for that"). Do not push add-ons or create urgency.

### Date & time intelligence
- Today is ${dateStr}; the local time is ${timeStr}. You KNOW the calendar.
- NEVER ask the caller what day or weekday a date falls on. If they say "June 23rd," work it out yourself and confirm naturally ("June 23rd is a Tuesday — we're open 10 to 7, what time works?"). Use the booking tools, which return the resolved weekday and hours.

### Speaking style (voice)
- 1–2 short sentences per turn. No lists, no markdown, no asterisks.
- Say prices and dates for the ear: "one hundred twenty dollars," "Tuesday, June twenty-third."
- Don't say "let me check" — answer as if you know.

### Booking flow
1) Understand the need. 2) Recommend honestly. 3) Collect name, service, day, time. 4) Read the details back. 5) Only then book. 6) Give the confirmation and a warm close.

### Ending the call
When the caller's need is met and they have nothing more, give a brief warm farewell and end the call yourself — don't wait for them to hang up.

### Knowledge base
BUSINESS: ${t.name}
ADDRESS: ${t.address}
PHONE: ${t.phone}
HOURS: ${t.hours}
SERVICES: ${servicesAsText(t)}
`.trim();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/prompt.test.ts` → Expected: PASS.

- [ ] **Step 5: Checkpoint** — founder reads the prompt; tune wording/persona to taste (this is the agent's "soul").

---

## Task 5: Function tools wrapping scheduling.ts (TDD)

**Files:**
- Create: `src/agent/tools.ts`
- Create: `tests/tools.test.ts`

**Interfaces:**
- Consumes: `checkAvailability`, `parseHours`, `newConfirmationId`, `fmtClock` (scheduling), `Appointment`.
- Produces: a factory `makeTools(ctx: { hours, appointments, now, tz, onBooking, onEndCall })` returning `{ checkAvailability, bookAppointment, endCall }` as `llm.tool(...)` objects. The booking/availability tool handlers return RICH objects (weekday, hours, readback) so the model never guesses.

- [ ] **Step 1: Write the failing test (handlers, not the LLM)**

```typescript
// tests/tools.test.ts
import { describe, it, expect } from 'vitest';
import { runAvailability, runBooking } from '../src/agent/tools.js';
import { parseHours, type Appointment } from '../src/scheduling.js';

const HOURS = parseHours('Mon-Wed: 10am-7pm, Thu-Fri: 10am-8pm, Sat: 9am-6pm, Sun: 11am-4pm');

describe('tool handlers', () => {
  it('availability returns the resolved weekday + hours (no caller math)', () => {
    const now = new Date('2026-06-21T12:00:00');
    const r = runAvailability({ service: 'Deep Tissue Massage', day: 'June 23', time: '3 PM' }, HOURS, [], now);
    expect(r.available).toBe(true);
    expect(r.weekday).toBe('Tuesday');
    expect(r.open).toBeDefined();
  });

  it('booking creates an appointment with a confirmation id and readback', () => {
    const now = new Date('2026-06-21T12:00:00');
    const appts: Appointment[] = [];
    const r = runBooking({ name: 'Dana', service: 'Facial', day: 'June 23', time: '2 PM' }, HOURS, appts, now);
    expect(r.success).toBe(true);
    expect(r.confirmationId).toMatch(/^SPA-/);
    expect(appts.length).toBe(1);
  });

  it('booking fails gracefully with a reason on a closed/invalid slot', () => {
    const now = new Date('2026-06-21T12:00:00');
    const r = runBooking({ name: 'Dana', service: 'Facial', day: 'June 23', time: '11 PM' }, HOURS, [], now);
    expect(r.success).toBe(false);
    expect(r.reason).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tools.test.ts` → Expected: FAIL (module not found).

- [ ] **Step 3: Implement pure handlers + tool wrappers in `src/agent/tools.ts`**

```typescript
import { z } from 'zod';
import { llm } from '@livekit/agents';
import {
  checkAvailability, fmtClock, newConfirmationId,
  type Appointment, type HoursTable,
} from '../scheduling.js';

// ---- pure, testable handlers (no LiveKit) -------------------------------
export function runAvailability(
  args: { service: string; day: string; time: string },
  hours: HoursTable, appts: Appointment[], now: Date,
) {
  const c = checkAvailability(args, hours, appts, now);
  if (!c.ok) return { available: false, reason: c.reason };
  return {
    available: true,
    weekday: c.weekdayName,
    open: fmtClock(c.openMin),
    close: fmtClock(c.closeMin),
    readback: `${args.service} on ${c.weekdayName} at ${fmtClock(c.resolved.startMin)}`,
  };
}

export function runBooking(
  args: { name: string; service: string; day: string; time: string },
  hours: HoursTable, appts: Appointment[], now: Date,
) {
  const c = checkAvailability({ service: args.service, day: args.day, time: args.time }, hours, appts, now);
  if (!c.ok) return { success: false, reason: c.reason };
  const appt: Appointment = {
    id: Date.now(), name: args.name, service: args.service, day: args.day, time: args.time,
    startMin: c.resolved.startMin, endMin: c.endMin, weekday: c.resolved.weekday,
    isoDate: c.resolved.isoDate, durationMin: c.durationMin, confirmationId: newConfirmationId(),
  };
  appts.push(appt);
  return {
    success: true, confirmationId: appt.confirmationId,
    readback: `${appt.service} on ${c.weekdayName} at ${fmtClock(appt.startMin)}`,
  };
}

// ---- LiveKit tool wrappers ---------------------------------------------
export function makeTools(ctx: {
  hours: HoursTable; appointments: Appointment[]; now: () => Date;
  onBooking?: (a: Appointment) => void; onEndCall?: () => void;
}) {
  return {
    checkAvailability: llm.tool({
      description: 'Check whether a service can be booked on a spoken day/time. Returns the resolved weekday and open hours so you can confirm naturally — never ask the caller what weekday a date is.',
      parameters: z.object({
        service: z.string(), day: z.string().describe("as spoken: 'today','tomorrow','Friday','June 23'"),
        time: z.string().describe("as spoken: '3 PM','3:30 PM'"),
      }),
      execute: async (a) => runAvailability(a, ctx.hours, ctx.appointments, ctx.now()),
    }),
    bookAppointment: llm.tool({
      description: 'Record a confirmed appointment. Call ONLY after the caller verbally confirms the read-back details.',
      parameters: z.object({
        name: z.string(), service: z.string(), day: z.string(), time: z.string(),
      }),
      execute: async (a) => {
        const before = ctx.appointments.length;
        const r = runBooking(a, ctx.hours, ctx.appointments, ctx.now());
        if (r.success && ctx.appointments.length > before) ctx.onBooking?.(ctx.appointments[ctx.appointments.length - 1]);
        return r;
      },
    }),
    endCall: llm.tool({
      description: 'End the call gracefully after a warm farewell, once the caller has nothing more.',
      parameters: z.object({}),
      execute: async () => { ctx.onEndCall?.(); return { ended: true }; },
    }),
  };
}
```

> **Verify against installed version:** confirm `llm.tool({ description, parameters, execute })` is the current signature: `node -e "const {llm}=require('@livekit/agents'); console.log(typeof llm.tool)"` → `function`. If the shape differs, keep `runAvailability`/`runBooking` (pure, tested) and adapt only the wrappers.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/tools.test.ts` → Expected: PASS (3 tests).

- [ ] **Step 5: Checkpoint** — founder confirms tools return rich results (the anti-"dumb-agent" pattern, spec §11.1 insight).

---

## Task 6: FAQ exact-answer cache (TDD)

**Files:**
- Create: `src/agent/faq-cache.ts`
- Create: `tests/faq-cache.test.ts`

**Interfaces:**
- Consumes: `TenantConfig`, `servicesAsText` (Task 3).
- Produces: `buildFaqCache(t: TenantConfig): Map<string,string>`, `lookupFaq(cache, text): string | null`.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/faq-cache.test.ts
import { describe, it, expect } from 'vitest';
import { buildFaqCache, lookupFaq } from '../src/agent/faq-cache.js';
import { getTenantConfig } from '../src/agent/tenant.js';

describe('faq cache', () => {
  it('answers "list services" and "hours" instantly from config', async () => {
    const cache = buildFaqCache(await getTenantConfig('lotus'));
    expect(lookupFaq(cache, 'what services do you offer')).toMatch(/Swedish/);
    expect(lookupFaq(cache, 'what are your hours')).toMatch(/Mon/);
  });
  it('returns null for non-FAQ (so the LLM handles it)', async () => {
    const cache = buildFaqCache(await getTenantConfig('lotus'));
    expect(lookupFaq(cache, 'can you cure my sciatica')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/faq-cache.test.ts` → Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/agent/faq-cache.ts`**

```typescript
import type { TenantConfig } from './tenant.js';
import { servicesAsText } from './tenant.js';

// Keyword-triggered exact answers. Only STABLE facts (never availability).
export function buildFaqCache(t: TenantConfig): Map<string, string> {
  const m = new Map<string, string>();
  m.set('services', `We offer ${servicesAsText(t)}`);
  m.set('hours', `Our hours are ${t.hours}.`);
  m.set('address', `We're at ${t.address}.`);
  m.set('phone', `You can reach us at ${t.phone}.`);
  return m;
}

const TRIGGERS: { key: string; words: RegExp }[] = [
  { key: 'services', words: /\b(services?|offer|treatments?|list|menu)\b/i },
  { key: 'hours', words: /\b(hours?|open|close|closing|timing)\b/i },
  { key: 'address', words: /\b(address|located|location|where are you|directions?)\b/i },
  { key: 'phone', words: /\b(phone|number|call you)\b/i },
];

export function lookupFaq(cache: Map<string, string>, text: string): string | null {
  for (const { key, words } of TRIGGERS) {
    if (words.test(text) && cache.has(key)) return cache.get(key)!;
  }
  return null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/faq-cache.test.ts` → Expected: PASS.

- [ ] **Step 5: Checkpoint** — note: this is the Phase-0 "exact cache" layer (spec §13.1 layer 1). Semantic cache is Phase 1.

---

## Task 7: Call store — transcript capture + outcome (TDD)

**Files:**
- Create: `src/agent/call-store.ts`
- Create: `tests/call-store.test.ts`

**Interfaces:**
- Produces: `interface CallRecord { id; tenantId; startedAt; endedAt?; transcript: {role,text,ts}[]; outcome; summary? }`, `class CallStore { start(tenantId): CallRecord; addTurn(id, role, text); finish(id, outcome, summary?); list(): CallRecord[] }`.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/call-store.test.ts
import { describe, it, expect } from 'vitest';
import { CallStore } from '../src/agent/call-store.js';

describe('call store', () => {
  it('captures a transcript and finishes with an outcome', () => {
    const s = new CallStore();
    const c = s.start('lotus');
    s.addTurn(c.id, 'assistant', 'Hi, thanks for calling Lotus.');
    s.addTurn(c.id, 'user', 'I want a facial Tuesday.');
    s.finish(c.id, 'booked', 'Caller booked a facial.');
    const rec = s.list()[0];
    expect(rec.transcript.length).toBe(2);
    expect(rec.outcome).toBe('booked');
    expect(rec.endedAt).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/call-store.test.ts` → Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/agent/call-store.ts`**

```typescript
export type Outcome = 'booked' | 'inquiry' | 'abandoned' | 'escalated';
export interface CallTurn { role: 'user' | 'assistant'; text: string; ts: number; }
export interface CallRecord {
  id: string; tenantId: string; startedAt: number; endedAt?: number;
  transcript: CallTurn[]; outcome?: Outcome; summary?: string;
}

export class CallStore {
  private calls = new Map<string, CallRecord>();
  start(tenantId: string): CallRecord {
    const rec: CallRecord = { id: `call-${Date.now()}`, tenantId, startedAt: Date.now(), transcript: [] };
    this.calls.set(rec.id, rec);
    return rec;
  }
  addTurn(id: string, role: 'user' | 'assistant', text: string) {
    this.calls.get(id)?.transcript.push({ role, text, ts: Date.now() });
  }
  finish(id: string, outcome: Outcome, summary?: string) {
    const rec = this.calls.get(id);
    if (rec) { rec.endedAt = Date.now(); rec.outcome = outcome; rec.summary = summary; }
  }
  list(): CallRecord[] { return [...this.calls.values()]; }
}

export const callStore = new CallStore(); // demo singleton; per-tenant DB later
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/call-store.test.ts` → Expected: PASS.

- [ ] **Step 5: Checkpoint** — this is the flywheel substrate (spec §17 Phase A); audio recording via Egress is Phase 1.

---

## Task 8: Providers seam (config-only)

**Files:**
- Create: `src/agent/providers.ts`

**Interfaces:**
- Produces: `makeSTT()`, `makeLLM()`, `makeTTS(voice: string)` returning plugin instances; the single place vendors are chosen.

- [ ] **Step 1: Implement `src/agent/providers.ts`**

```typescript
import * as deepgram from '@livekit/agents-plugin-deepgram';
import * as google from '@livekit/agents-plugin-google';

// The ONLY place model vendors are chosen. Swap here, not in the pipeline.
export function makeSTT() {
  return new deepgram.STT({ model: 'nova-3', language: 'en-US' });
}
export function makeLLM() {
  // Gemini Flash on GCP (spec D4). Reads GOOGLE_API_KEY from env.
  return new google.LLM({ model: 'gemini-2.5-flash', temperature: 0.4 });
}
export function makeTTS(voice: string) {
  return new deepgram.TTS({ model: voice }); // e.g. 'aura-2-thalia-en'
}
```

> **Verify against installed versions** (class names differ by plugin version):
> ```bash
> node -e "console.log(Object.keys(require('@livekit/agents-plugin-deepgram')))"
> node -e "console.log(Object.keys(require('@livekit/agents-plugin-google')))"
> ```
> Expect `STT`/`TTS` from deepgram and `LLM` from google. If a name differs (e.g. nested under `beta`), adjust imports here only.

- [ ] **Step 2: Checkpoint** — `npx tsc --noEmit` compiles `providers.ts`. (No unit test — this is config; it's exercised in Task 9.)

---

## Task 9: Agent worker — wire the streaming pipeline + greeting/consent + capture

**Files:**
- Modify: `src/agent/worker.ts`

**Interfaces:**
- Consumes: everything from Tasks 2–8.
- Produces: a running agent that greets with a consent line, converses, books, ends gracefully, and records the transcript.

- [ ] **Step 1: Implement the full worker**

```typescript
import {
  WorkerOptions, cli, defineAgent, voice, type JobContext,
} from '@livekit/agents';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

import { getTenantConfig } from './tenant.js';
import { buildSystemPrompt } from './prompt.js';
import { makeTools } from './tools.js';
import { makeSTT, makeLLM, makeTTS } from './providers.js';
import { parseHours, type Appointment } from '../scheduling.js';
import { callStore } from './call-store.js';

dotenv.config();

// NOTE (verified against @livekit/agents@1.4.8): the standalone silero VAD plugin and
// the text-based turnDetector plugin are DEPRECATED. AgentSession uses a bundled silero
// VAD + native audio turn detection via @livekit/local-inference automatically — omit
// `vad`/`turnDetection` entirely. Do NOT re-add those plugins.
export default defineAgent({
  entry: async (ctx: JobContext) => {
    await ctx.connect();
    const tenant = await getTenantConfig('lotus');
    const hours = parseHours(tenant.hours);
    const appointments: Appointment[] = [];
    const call = callStore.start(tenant.id);

    let endRequested = false;
    const tools = makeTools({
      hours, appointments, now: () => new Date(),
      onEndCall: () => { endRequested = true; },
    });

    const agent = new voice.Agent({
      instructions: buildSystemPrompt(tenant, new Date()),
      tools,
    });

    const session = new voice.AgentSession({
      stt: makeSTT(),
      llm: makeLLM(),
      tts: makeTTS(tenant.voice),
      // vad + turnDetection: bundled defaults via local-inference (patient native EOT).
    });

    // Capture transcript turns for the call record (spec §12.1).
    session.on(voice.AgentSessionEventTypes.ConversationItemAdded, (ev: any) => {
      const role = ev?.item?.role;
      const text = ev?.item?.textContent ?? ev?.item?.content ?? ev?.item?.text;
      if ((role === 'user' || role === 'assistant') && text) {
        callStore.addTurn(call.id, role, typeof text === 'string' ? text : String(text));
      }
    });

    await session.start({ agent, room: ctx.room });

    // Greeting WITH spoken recording consent (spec §21.3).
    await session.generateReply({
      instructions: `Greet warmly as Lotus for ${tenant.name}. In the same breath, mention this call may be recorded for quality. Then ask how you can help. Keep it to two short sentences.`,
    });

    // Graceful auto-end: when a tool requested end, say bye and close (spec §12.3).
    const endTimer = setInterval(async () => {
      if (endRequested) {
        clearInterval(endTimer);
        callStore.finish(call.id, appointments.length ? 'booked' : 'inquiry');
        await ctx.room.disconnect();
      }
    }, 500);
  },
});

cli.runApp(new WorkerOptions({ agent: fileURLToPath(import.meta.url) }));
```

> **Already verified against @livekit/agents@1.4.8:** `voice.AgentSessionEventTypes.ConversationItemAdded === 'conversation_item_added'` exists; bundled VAD + turn detection come from `@livekit/local-inference@0.2.5` (installed). If the captured `ev.item` text field differs at runtime, log one event during the Task 10 live test and adjust the text accessor — the pure modules (Tasks 2–7) are unaffected.

- [ ] **Step 2: Checkpoint — talk to it once a room exists**

This needs a browser to join (Task 10) to fully test. For now, type-check: `npx tsc --noEmit` → Expected: no errors in `worker.ts`. Full conversational verification happens in Task 10 Step 5.

---

## Task 10: Browser client on `livekit-client` + token endpoint

**Files:**
- Create: `src/server/token.ts`
- Rewrite: `src/client.tsx`
- Modify: `vite.config.ts` (proxy `/api` to the token server) if needed

**Interfaces:**
- Consumes: a running LiveKit dev server + agent worker.
- Produces: a browser page where clicking "Start Call" joins a room (the agent auto-joins), streams mic audio, plays agent audio, and shows the live transcript.

- [ ] **Step 1: Token endpoint `src/server/token.ts`**

```typescript
import express from 'express';
import { AccessToken } from 'livekit-server-sdk';
import dotenv from 'dotenv';
dotenv.config();

const app = express();
app.get('/api/token', async (_req, res) => {
  const room = 'lotus-demo';
  const at = new AccessToken(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, {
    identity: `web-${Date.now()}`,
  });
  at.addGrant({ roomJoin: true, room, canPublish: true, canSubscribe: true });
  res.json({ token: await at.toJwt(), url: process.env.LIVEKIT_URL, room });
});

app.listen(3001, () => console.log('token server on http://localhost:3001'));
```

- [ ] **Step 2: Proxy in `vite.config.ts`**

Add to the Vite config `server` block:

```typescript
server: { proxy: { '/api': 'http://localhost:3001' } },
```

- [ ] **Step 3: Rewrite `src/client.tsx` to use `livekit-client`**

```tsx
import { useState, useRef } from 'react';
import { Room, RoomEvent, Track } from 'livekit-client';

interface Msg { role: 'user' | 'assistant'; text: string; }

export default function App() {
  const [live, setLive] = useState(false);
  const [transcript, setTranscript] = useState<Msg[]>([]);
  const roomRef = useRef<Room | null>(null);

  const start = async () => {
    const { token, url } = await fetch('/api/token').then((r) => r.json());
    const room = new Room();
    roomRef.current = room;

    room.on(RoomEvent.TrackSubscribed, (track) => {
      if (track.kind === Track.Kind.Audio) track.attach(); // plays agent audio
    });
    // Live transcript via LiveKit text streams / transcription events:
    room.on(RoomEvent.TranscriptionReceived as any, (segments: any[], participant: any) => {
      const role = participant?.isLocal ? 'user' : 'assistant';
      const text = segments.map((s) => s.text).join(' ');
      if (text) setTranscript((p) => [...p, { role, text }]);
    });

    await room.connect(url, token);
    await room.localParticipant.setMicrophoneEnabled(true);
    setLive(true);
  };

  const end = async () => {
    await roomRef.current?.disconnect();
    setLive(false);
  };

  return (
    <div className="app-container">
      <main className="main-content">
        <header className="agent-header"><h1>Lotus — Voice Demo</h1></header>
        <div className="call-controls">
          <button className={`start-btn ${live ? 'end' : ''}`} onClick={live ? end : start}>
            {live ? '🛑 End Call' : '📞 Start Browser Call'}
          </button>
        </div>
        <div className="transcript-container">
          {transcript.length === 0
            ? <div style={{ textAlign: 'center', color: '#9ca3af', marginTop: '4rem' }}>Transcript appears here.</div>
            : transcript.map((m, i) => (
                <div className={`message ${m.role}`} key={i}>
                  <span className="msg-label">{m.role === 'user' ? 'You' : 'Lotus'}</span>{m.text}
                </div>
              ))}
        </div>
      </main>
    </div>
  );
}
```

> **Verify against installed version:** the transcription event name in `livekit-client` is version-sensitive (`RoomEvent.TranscriptionReceived` in recent versions). Check: `node -e "const {RoomEvent}=require('livekit-client'); console.log(Object.keys(RoomEvent).filter(k=>/transcri/i.test(k)))"`. If absent, render transcript from the agent side via a data message instead. Audio playback (TrackSubscribed→attach) is stable.

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit` → Expected: no errors.

- [ ] **Step 5: Checkpoint — FULL END-TO-END demo (the real test)**

Run four terminals:
1. `npm run livekit` (media server)
2. `npm run agent` (Lotus worker)
3. `npm run token-server`
4. `npm run dev` (Vite) → open the printed localhost URL.

Click **Start Browser Call**. Verify the manual checklist (spec §16.1):
- Lotus greets + mentions recording, asks how she can help.
- You can interrupt her mid-sentence (barge-in) and she stops.
- You can pause mid-sentence and she waits (doesn't cut you off).
- Say "book me a deep tissue on June 23rd at 3pm" → she states **"June 23rd is a Tuesday…"** (NEVER asks what day it is), reads back, books, gives a confirmation.
- Ask "do you have discounts / what services?" → fast, grounded answer.
- "Will this cure my back pain?" → honest, no guarantee.
- Say "that's all, thanks" → she says goodbye and **ends the call herself**.
- After hangup, `callStore.list()` (log it) shows the transcript + outcome.

Founder reviews feel + latency; log any failure → it becomes a Task 11 eval scenario.

---

## Task 11: Eval suite — scenario runner + recursive loop (TDD)

**Files:**
- Create: `src/eval/run-evals.ts`
- Create: `src/eval/scenarios.ts`
- Create: `tests/eval-scenarios.test.ts` (logic-level assertions on tool/scheduling behavior)

**Interfaces:**
- Consumes: `runAvailability`, `runBooking` (Task 5), `lookupFaq` (Task 6).
- Produces: a seed set of scenarios + a runner that asserts deterministic outcomes; LLM-judge hook for subjective scoring (spec §16.2).

- [ ] **Step 1: Write logic-level eval tests (deterministic, no API)**

```typescript
// tests/eval-scenarios.test.ts
import { describe, it, expect } from 'vitest';
import { runAvailability, runBooking } from '../src/agent/tools.js';
import { lookupFaq, buildFaqCache } from '../src/agent/faq-cache.js';
import { getTenantConfig } from '../src/agent/tenant.js';
import { parseHours } from '../src/scheduling.js';

const HOURS = parseHours('Mon-Wed: 10am-7pm, Thu-Fri: 10am-8pm, Sat: 9am-6pm, Sun: 11am-4pm');
const NOW = new Date('2026-06-21T12:00:00');

describe('eval: core behaviors that must never regress', () => {
  it('date-intelligence: June 23rd resolves to Tuesday with hours', () => {
    const r = runAvailability({ service: 'Facial', day: 'June 23', time: '2 PM' }, HOURS, [], NOW);
    expect(r.available && r.weekday).toBe('Tuesday');
  });
  it('booking happy-path produces a confirmation', () => {
    const r = runBooking({ name: 'Dana', service: 'Swedish Massage', day: 'June 23', time: '2 PM' }, HOURS, [], NOW);
    expect(r.success).toBe(true);
  });
  it('FAQ: services question is answerable without the LLM', async () => {
    const cache = buildFaqCache(await getTenantConfig('lotus'));
    expect(lookupFaq(cache, 'list your services')).toMatch(/Swedish/);
  });
});
```

- [ ] **Step 2: Run to verify it fails then passes**

Run: `npx vitest run tests/eval-scenarios.test.ts` → If Tasks 5–6 are done it PASSES; if you wrote this first it FAILS until they are. (TDD ordering: this codifies the spec's required behaviors as permanent guards.)

- [ ] **Step 3: Implement the conversational scenario seed `src/eval/scenarios.ts`**

```typescript
export interface Scenario {
  name: string;
  turns: string[];          // caller utterances in order
  expect: string;           // what the judge checks for (rubric)
}
export const SCENARIOS: Scenario[] = [
  { name: 'booking-happy-path', turns: ['I want a deep tissue massage', 'June 23rd at 3pm', 'yes that works'], expect: 'Confirms June 23rd is a Tuesday WITHOUT asking the caller, reads back, books, gives a confirmation id.' },
  { name: 'honesty-no-guarantee', turns: ['will a massage definitely cure my sciatica?'], expect: 'Does NOT guarantee a cure; describes what it is good for honestly.' },
  { name: 'consultative-downsell', turns: ['I just have a bit of tension, should I get the 90-minute deep tissue?'], expect: 'May suggest the shorter/cheaper option fits; no pressure.' },
  { name: 'patience', turns: ['I want a facial on... um... let me think... the 23rd'], expect: 'Waits for the full sentence; does not interrupt or mis-handle the pause.' },
  { name: 'graceful-end', turns: ["that's all, thanks!"], expect: 'Warm farewell and ends the call itself.' },
];
```

- [ ] **Step 4: Implement the runner `src/eval/run-evals.ts`**

```typescript
import { SCENARIOS } from './scenarios.js';
// Conversational eval: drive the LLM with each scenario, score with an LLM judge.
// For Phase 0 this runs the model in text mode (cheap, deterministic-ish) and prints a rubric score.
// Wire your Gemini key; the judge prompt asks for PASS/FAIL + reason per `scenario.expect`.

async function main() {
  for (const s of SCENARIOS) {
    // 1) run the agent's LLM over s.turns with the system prompt + tools (text mode)
    // 2) ask a judge model: does the transcript satisfy s.expect? return PASS/FAIL+reason
    // 3) print: `${s.name}: PASS/FAIL — reason`
    console.log(`[eval] ${s.name}: (implement model+judge call) — expects: ${s.expect}`);
  }
}
main();
```

> This runner's model/judge wiring is intentionally thin for Phase 0 — the deterministic guards (Step 1) already protect the core. Flesh out the judge call once the browser demo is stable; every new real-world failure gets appended to `SCENARIOS` (spec §16.3 recursive loop).

- [ ] **Step 5: Run + Checkpoint**

Run: `npx vitest run` (whole suite) → Expected: all PASS. `npx tsx src/eval/run-evals.ts` prints the scenario list. Founder reviews; add any demo failures from Task 10 as new scenarios.

---

## Self-Review (completed)

**Spec coverage:**
- §4/§6 streaming pipeline → Task 9 (AgentSession). §8/§8.1 turn-taking → Task 9 (VAD + turnDetector). §11.0 persona → Task 4. §11.1 date intelligence → Tasks 2, 5, 11. §12.1 call storage → Task 7, 9. §12.2/§12.3 reliability/auto-end → Task 9 (endCall tool + timer; watchdog timers are a documented follow-up within Task 9's lifecycle helper). §13.1 caching → Task 6. §16 evals → Task 11. §21.3 consent → Task 9 greeting. Tenant/KB §5.2/§9 → Task 3. Providers seam §5.4 → Task 8. Browser client §5.7 → Task 10.
- **Gap noted:** §12.3 silence/inaudible *watchdog* and audio Egress recording are scoped as documented follow-ups (the auto-end path and transcript capture ARE implemented). Add `src/agent/lifecycle.ts` watchdog wiring as a fast-follow once the base demo converses — it depends on observing the real session event names, which Task 9 Step 1's verification surfaces.

**Placeholder scan:** the eval runner (Task 11 Step 4) is intentionally thin but the deterministic guards are complete; flagged, not hidden.

**Type consistency:** `runAvailability`/`runBooking` signatures match between Tasks 5 and 11; `TenantConfig`/`Service` consistent across Tasks 3, 4, 6; `CallStore` API consistent across Tasks 7, 9.

---

## Execution note for the founder

This plan front-loads the **pure, fully-tested logic** (Tasks 2–7) so most of the product's correctness is locked by `vitest` before any LiveKit wiring. The LiveKit-specific tasks (9, 10) are verified by **running the real demo** (Task 10 Step 5) — that's the honest test for "feels human & instant." Where the LiveKit API is version-sensitive, each such step carries a one-line `node -e` verification so you confirm the real surface instead of trusting a snippet.
