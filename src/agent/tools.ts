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
      // Gemini reliably invokes a tool that carries a parameter; a zero-arg tool was
      // being skipped entirely (the model spoke a farewell but never ended the call).
      // Do NOT speak a goodbye yourself — a brief closing line is played automatically.
      description: 'End the phone call. Call this as soon as the caller has nothing more (e.g. they say bye/thanks/that\'s all). A farewell is spoken automatically, so do not say goodbye yourself.',
      parameters: z.object({
        reason: z.string().describe("why the call is ending, e.g. 'caller said goodbye' or 'booking complete'"),
      }),
      // Return nothing on purpose: a tool with no output sets replyRequired=false in
      // @livekit/agents, so the model does NOT auto-generate a follow-up turn after
      // ending. The worker (onEndCall → wrapUp) owns the spoken farewell + hangup.
      execute: async () => { ctx.onEndCall?.(); },
    }),
  };
}
