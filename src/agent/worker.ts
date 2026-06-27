import {
  WorkerOptions, cli, defineAgent, voice, type JobContext,
} from '@livekit/agents';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

import { getTenantConfig, tenantFromKB } from './tenant.js';
import { buildSystemPrompt } from './prompt.js';
import { makeTools } from './tools.js';
import { makeSTT, makeLLM, makeTTS, type ModelChoice } from './providers.js';
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
    // Room name from token server: lotus-demo__<model>__<unique>. Model is segment 1.
    const model: ModelChoice = ctx.room.name?.split('__')[1] === 'deepseek' ? 'deepseek' : 'gemini';
    console.log(`[agent] using LLM: ${model}`);

    // The browser ships its edited KB as participant metadata on the token. Wait
    // for the caller, read it, and ground the agent in it. Falls back to the
    // hardcoded Lotus config if metadata is missing/garbage so a bad edit can
    // never take the agent down.
    let tenant = await getTenantConfig('lotus');
    try {
      const caller = await ctx.waitForParticipant();
      if (caller.metadata) tenant = tenantFromKB(JSON.parse(caller.metadata));
    } catch (e) {
      console.error('[agent] could not read KB from participant metadata, using defaults:', e);
    }
    const hours = parseHours(tenant.hours);
    const appointments: Appointment[] = [];
    const call = callStore.start(tenant.id);

    const tools = makeTools({
      hours, appointments, now: () => new Date(),
      // Push each confirmed booking to the browser so the bookings rail updates
      // live (spec §5.7). Reliable data msg on the 'booking' topic; fire-and-forget.
      onBooking: (appt) => {
        const payload = new TextEncoder().encode(JSON.stringify({ type: 'booking', appt }));
        ctx.room.localParticipant
          ?.publishData(payload, { reliable: true, topic: 'booking' })
          .catch((e) => console.error('[agent] publishData(booking) failed:', e));
      },
      onEndCall: () => { void wrapUp(appointments.length ? 'booked' : 'inquiry'); },
    });

    const agent = new voice.Agent({
      instructions: buildSystemPrompt(tenant, new Date()),
      tools,
    });

    const session = new voice.AgentSession({
      stt: makeSTT(),
      llm: makeLLM(model),
      tts: makeTTS(tenant.voice),
      // vad + turnDetection: bundled defaults via local-inference (patient native EOT).
      // The LiveKit Cloud *semantic* turn detector requires an inference entitlement;
      // when it's unavailable the session falls back to VAD-only interruption, which
      // treats ANY mic sound (room noise, echo) as a barge-in and cuts the agent off
      // mid-utterance. These two guards require real, sustained speech before an
      // interruption counts, so ambient noise can't silence the agent.
      turnHandling: {
        interruption: {
          minDuration: 600, // ms of speech before it counts as a real interruption
          minWords: 1,      // ...and at least one transcribed word
        },
      },
      // Auto-end when the caller goes silent (spec §12.3): flips userState to 'away'.
      userAwayTimeout: 20,
    });

    // Single graceful close — speak a short farewell, then disconnect. Used by both
    // the endCall tool (caller is done) and the idle timeout (caller went silent).
    // The farewell is worker-driven on purpose: gemini-flash-lite reliably *calls*
    // endCall but doesn't reliably *speak* a goodbye in the same turn, so we say it.
    let ending = false;
    const wrapUp = async (outcome: 'booked' | 'inquiry') => {
      if (ending) return;
      ending = true;
      // Let the current turn (e.g. the endCall tool call) settle before we speak.
      while (session.agentState === 'speaking' || session.agentState === 'thinking') {
        await new Promise((r) => setTimeout(r, 150));
      }
      // generateReply resolves on playout completion (SpeechHandle is thenable),
      // so the farewell is fully heard before we tear down the room.
      await session.generateReply({
        instructions: 'Give a brief, warm farewell in one short sentence — the call is ending now.',
        allowInterruptions: false,
        toolChoice: 'none', // speak only; don't let the model re-emit endCall as text
      });
      callStore.finish(call.id, outcome);
      await ctx.room.disconnect();
    };

    // Idle hangup: caller went quiet (userState → 'away' after userAwayTimeout) →
    // wrap up instead of holding the line open indefinitely (spec §12.3).
    // ponytail: single goodbye-then-hangup; add a "still there?" re-prompt first if
    // callers complain it's too abrupt.
    session.on(voice.AgentSessionEventTypes.UserStateChanged, (ev: any) => {
      if (ev?.newState === 'away') void wrapUp(appointments.length ? 'booked' : 'inquiry');
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
    // allowInterruptions:false is critical: without the semantic turn detector the
    // session interrupts on raw VAD, and the browser opens its mic immediately — any
    // ambient noise would otherwise cancel the greeting's LLM stream before a word
    // is spoken. The greeting must always play in full.
    await session.generateReply({
      instructions: `Greet warmly as Lotus for ${tenant.name}. In the same breath, mention this call may be recorded for quality. Then ask how you can help. Keep it to two short sentences.`,
      allowInterruptions: false,
    });
  },
});

cli.runApp(new WorkerOptions({ agent: fileURLToPath(import.meta.url) }));
