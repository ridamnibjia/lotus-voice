import { Agent, routeAgentRequest, type Connection } from "agents";
import {
  withVoice,
  WorkersAITTS,
  type VoiceTurnContext,
} from "@cloudflare/voice";
import { TwilioAdapter } from "@cloudflare/voice-twilio";
import { DeepgramSTT } from "./deepgram";
import { streamText, tool, stepCountIs } from "ai";
import { createWorkersAI } from "workers-ai-provider";
import { z } from "zod";
import { buildSystemPrompt } from "./system-prompt";
import { SPA } from "./knowledge-base";

const VoiceAgent = withVoice(Agent);

export class SpaAgent extends VoiceAgent<Env> {
  transcriber = new DeepgramSTT({
    apiKey: this.env.DEEPGRAM_API_KEY as string,
  });
  tts = new WorkersAITTS(this.env.AI);

  #system = buildSystemPrompt();
  #activeConnection: Connection | null = null;
  #ending = false;

  // Drop noise / empty utterances before the LLM sees them.
  afterTranscribe(transcript: string, _connection: Connection) {
    const t = transcript.trim();
    return t.length < 3 ? null : t;
  }

  // Safety net: never speak a raw tool-call JSON blob if one ever leaks.
  beforeSynthesize(text: string) {
    const t = text.trim();
    if (t.startsWith("{") && (t.includes("function") || t.includes("parameters"))) {
      return null;
    }
    return text;
  }

  async onCallStart(connection: Connection) {
    this.#activeConnection = connection;
    this.#ending = false;
    await this.speak(
      connection,
      `Thanks for calling ${SPA.name}. I can tell you about our services, hours, and pricing, book you an appointment, or check one you already have. How can I help?`
    );
  }

  onCallEnd(_connection: Connection) {
    this.#activeConnection = null;
  }

  async onTurn(transcript: string, context: VoiceTurnContext) {
    const workersAi = createWorkersAI({ binding: this.env.AI });

    const result = streamText({
      model: workersAi("@cf/moonshotai/kimi-k2.6"),
      system: this.#system,
      messages: [
        ...context.messages.map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        })),
        { role: "user" as const, content: transcript },
      ],
      tools: {
        book_appointment: tool({
          description:
            "Record a confirmed appointment. Call ONLY after the caller verbally confirms the read-back of name, service, day and time.",
          inputSchema: z.object({
            name: z.string().describe("Caller's full name"),
            service: z.string().describe("Service being booked"),
            day: z.string().describe("Day of appointment"),
            time: z.string().describe("Time of appointment"),
          }),
          execute: async ({ name, service, day, time }) => {
            const confirmationId =
              "LUM-" + Math.random().toString(36).slice(2, 7).toUpperCase();
            await this.logEvent("booking", { confirmationId, name, service, day, time });
            return { success: true, confirmationId };
          },
        }),
        check_appointment: tool({
          description:
            "Look up an existing appointment. Requires phone on file AND one verifying detail (name or date). Returns at most one record.",
          inputSchema: z.object({
            phone: z.string().describe("Phone number on file"),
            verifier: z.string().describe("Name or appointment date"),
          }),
          execute: async ({ phone, verifier }) => {
            const DEMO = { phone: "4155550199", record: "Swedish Massage, Friday at 2:00 PM" };
            const norm = phone.replace(/\D/g, "");
            const v = verifier.toLowerCase();
            if (norm === DEMO.phone && (v.includes("jordan") || v.includes("friday"))) {
              return { found: true, details: DEMO.record };
            }
            return { found: false };
          },
        }),
        end_call: tool({
          description:
            "End the call ONLY when the caller has clearly finished — they say goodbye, thanks that's all, or similar. Provide a short, warm farewell.",
          inputSchema: z.object({
            farewell: z
              .string()
              .describe("A short spoken goodbye, e.g. 'Thanks for calling, have a relaxing day!'"),
          }),
          execute: async ({ farewell }) => {
            if (this.#activeConnection && !this.#ending) {
              this.#ending = true;
              await this.speak(this.#activeConnection, farewell);
              const ms = Math.min(6000, Math.max(2000, farewell.length * 70));
              await this.schedule(ms / 1000, "hangUp", {});
            }
            return { ended: true };
          },
        }),
      },
      stopWhen: stepCountIs(3),
      abortSignal: context.signal,
    });

    return result.textStream;
  }

  // Scheduled hang-up (runs after the farewell audio has flushed).
  async hangUp() {
    if (this.#activeConnection) {
      if (typeof this.#activeConnection.close === 'function') {
        this.#activeConnection.close();
      } else if (typeof (this as any).forceEndCall === 'function') {
        (this as any).forceEndCall(this.#activeConnection);
      }
      this.#activeConnection = null;
    }
  }

  // ── Call log in the DO's SQLite, phone numbers redacted ───────────────
  async logEvent(kind: string, data: Record<string, unknown>) {
    const redacted = JSON.parse(
      JSON.stringify(data).replace(/\b\d{10,}\b/g, "[redacted-phone]")
    );
    this.sql`CREATE TABLE IF NOT EXISTS call_log (ts INTEGER, kind TEXT, payload TEXT)`;
    this.sql`INSERT INTO call_log (ts, kind, payload)
             VALUES (${Date.now()}, ${kind}, ${JSON.stringify(redacted)})`;
  }

  async onRequest(request: Request): Promise<Response> {
    if (new URL(request.url).pathname.endsWith("/__log")) {
      this.sql`CREATE TABLE IF NOT EXISTS call_log (ts INTEGER, kind TEXT, payload TEXT)`;
      const rows = this.sql`SELECT ts, kind, payload FROM call_log ORDER BY ts DESC LIMIT 200`;
      return Response.json(rows);
    }
    return new Response("Not found", { status: 404 });
  }
}

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);

    if (url.pathname === "/admin/log") {
      const id = env.SpaAgent.idFromName("lotus"); // was "lumina", updated to "lotus"
      return env.SpaAgent.get(id).fetch(new Request("https://do/__log"));
    }

    if (url.pathname === "/twilio") {
      return TwilioAdapter.handleRequest(request, env, "SpaAgent");
    }

    return (
      (await routeAgentRequest(request, env)) ??
      new Response("Not found", { status: 404 })
    );
  },
} satisfies ExportedHandler<Env>;

interface Env {
  AI: Ai;
  DEEPGRAM_API_KEY?: string;
  SpaAgent: DurableObjectNamespace;
}
