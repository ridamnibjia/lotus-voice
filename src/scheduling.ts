/**
 * scheduling.ts
 * Real availability logic: parse business hours, know service durations,
 * and validate a requested booking against (a) open hours and (b) existing
 * bookings. In-memory only for the MVP — bookings live on the connection.
 *
 * Everything here is pure/testable: no Deepgram, no LLM, no websockets.
 */

export interface Appointment {
    id: number;
    name: string;
    service: string;
    day: string;      // human label as spoken, e.g. "Tuesday" or "2026-06-09"
    time: string;     // human label as spoken, e.g. "3:00 PM"
    startMin: number; // minutes from midnight, resolved
    endMin: number;
    weekday: number;  // 0=Sun..6=Sat, resolved date the appt falls on
    isoDate: string;  // YYYY-MM-DD the appt resolves to
    durationMin: number;
    confirmationId: string;
  }
  
  // Service -> duration in minutes. Keyed by a normalized substring match so
  // "Swedish Massage", "deep tissue massage", "60 min facial" all resolve.
  const SERVICE_DURATIONS: { match: RegExp; minutes: number }[] = [
    { match: /deep\s*tissue/i, minutes: 90 },
    { match: /swedish/i, minutes: 60 },
    { match: /massage/i, minutes: 60 },
    { match: /facial/i, minutes: 60 },
  ];
  const DEFAULT_DURATION = 60;
  
  export function resolveDuration(service: string): number {
    for (const { match, minutes } of SERVICE_DURATIONS) {
      if (match.test(service)) return minutes;
    }
    return DEFAULT_DURATION;
  }

  const WEEKDAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  export function weekdayName(weekday: number): string {
    return WEEKDAYS[((weekday % 7) + 7) % 7];
  }
  
  // ---- Hours parsing -------------------------------------------------------
  // We accept the loose format the KB uses, e.g.
  //   "Mon-Wed: 10am-7pm, Thu-Fri: 10am-8pm, Sat: 9am-6pm, Sun: 11am-4pm"
  // and turn it into per-weekday open/close minute ranges. A closed day has
  // no entry. This is intentionally forgiving — if a chunk doesn't parse we
  // skip it rather than throw, because the KB is human-edited free text.
  
  const DAY_INDEX: Record<string, number> = {
    sun: 0, sunday: 0,
    mon: 1, monday: 1,
    tue: 2, tues: 2, tuesday: 2,
    wed: 3, weds: 3, wednesday: 3,
    thu: 4, thur: 4, thurs: 4, thursday: 4,
    fri: 5, friday: 5,
    sat: 6, saturday: 6,
  };
  
  interface OpenRange { open: number; close: number } // minutes from midnight
  
  export type HoursTable = Map<number, OpenRange>; // weekday -> hours (absent = closed)
  
  function parseClock(raw: string): number | null {
    // "10am", "7pm", "9:30am", "12pm"
    const m = raw.trim().toLowerCase().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/);
    if (!m) return null;
    let h = parseInt(m[1], 10);
    const min = m[2] ? parseInt(m[2], 10) : 0;
    const mer = m[3];
    if (h === 12) h = 0;
    if (mer === "pm") h += 12;
    return h * 60 + min;
  }
  
  function expandDayRange(token: string): number[] {
    // "Mon-Wed" -> [1,2,3]; "Sat" -> [6]
    const parts = token.split("-").map((s) => s.trim().toLowerCase());
    if (parts.length === 1) {
      const d = DAY_INDEX[parts[0]];
      return d === undefined ? [] : [d];
    }
    const a = DAY_INDEX[parts[0]];
    const b = DAY_INDEX[parts[1]];
    if (a === undefined || b === undefined) return [];
    const out: number[] = [];
    for (let i = a; ; i = (i + 1) % 7) {
      out.push(i);
      if (i === b) break;
    }
    return out;
  }
  
  export function parseHours(hoursStr: string): HoursTable {
    const table: HoursTable = new Map();
    for (const segment of hoursStr.split(",")) {
      const [dayPart, timePart] = segment.split(":").length >= 2
        ? [segment.slice(0, segment.indexOf(":")), segment.slice(segment.indexOf(":") + 1)]
        : [segment, ""];
      if (!timePart) continue;
      const range = timePart.trim().match(/^(.+?)\s*-\s*(.+)$/);
      if (!range) continue;
      const open = parseClock(range[1]);
      const close = parseClock(range[2]);
      if (open === null || close === null) continue;
      for (const d of expandDayRange(dayPart.trim())) {
        table.set(d, { open, close });
      }
    }
    return table;
  }
  
  // ---- Date/time resolution -----------------------------------------------
  // Resolve a spoken day ("today", "tomorrow", "Friday", "June 9") + spoken
  // time ("3pm", "3:30 PM") into a concrete ISO date + minute offset, relative
  // to `now`. Returns null if we can't confidently resolve — the caller then
  // asks the LLM to re-confirm rather than guessing.
  
  export interface ResolvedWhen {
    isoDate: string;
    weekday: number;
    startMin: number;
  }
  
  export function resolveWhen(day: string, time: string, now: Date): ResolvedWhen | null {
    const startMin = parseClock(time.replace(/\s+/g, "")) ??
      parseLooseClock(time);
    if (startMin === null) return null;
  
    const target = new Date(now);
    const lc = day.trim().toLowerCase();
  
    if (lc === "today") {
      // keep target as today
    } else if (lc === "tomorrow") {
      target.setDate(target.getDate() + 1);
    } else if (DAY_INDEX[lc] !== undefined) {
      const want = DAY_INDEX[lc];
      let delta = (want - target.getDay() + 7) % 7;
      if (delta === 0) delta = 7; // "Friday" when today is Friday -> next Friday
      target.setDate(target.getDate() + delta);
    } else {
      // Try "June 9" / "June 9th 2026" style
      const parsed = Date.parse(`${day} ${now.getFullYear()}`);
      if (Number.isNaN(parsed)) return null;
      const d = new Date(parsed);
      target.setFullYear(d.getFullYear(), d.getMonth(), d.getDate());
    }
  
    return {
      isoDate: toISODate(target),
      weekday: target.getDay(),
      startMin,
    };
  }
  
  function parseLooseClock(raw: string): number | null {
    // catches "3 pm", "3 o'clock pm" loosely -> normalize then reuse parseClock
    const cleaned = raw.toLowerCase().replace(/o'?clock/g, "").replace(/\s+/g, "");
    return parseClock(cleaned);
  }
  
  function toISODate(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }
  
  // ---- Validation ----------------------------------------------------------
  
  export type SlotCheck =
    | { ok: true; resolved: ResolvedWhen; durationMin: number; endMin: number;
        weekdayName: string; openMin: number; closeMin: number }
    | { ok: false; reason: string };
  
  export function checkAvailability(
    args: { service: string; day: string; time: string },
    hours: HoursTable,
    existing: Appointment[],
    now: Date
  ): SlotCheck {
    const resolved = resolveWhen(args.day, args.time, now);
    if (!resolved) {
      return { ok: false, reason: "I couldn't pin down that day and time. Could you say it again, like 'this Friday at 3 PM'?" };
    }
  
    const dayHours = hours.get(resolved.weekday);
    if (!dayHours) {
      return { ok: false, reason: `We're closed that day. Would another day work?` };
    }
  
    const durationMin = resolveDuration(args.service);
    const endMin = resolved.startMin + durationMin;
  
    if (resolved.startMin < dayHours.open || endMin > dayHours.close) {
      return {
        ok: false,
        reason: `That time runs outside our hours for that day. We're open from ${fmtClock(dayHours.open)} to ${fmtClock(dayHours.close)}.`,
      };
    }
  
    // Don't allow booking in the past for today.
    if (resolved.isoDate === toISODate(now)) {
      const nowMin = now.getHours() * 60 + now.getMinutes();
      if (resolved.startMin <= nowMin) {
        return { ok: false, reason: "That time has already passed today. Would later today or another day work?" };
      }
    }
  
    // Overlap check against existing bookings on the same date.
    for (const appt of existing) {
      if (appt.isoDate !== resolved.isoDate) continue;
      const overlap = resolved.startMin < appt.endMin && endMin > appt.startMin;
      if (overlap) {
        return { ok: false, reason: "That slot's already taken. Want me to find the next opening?" };
      }
    }
  
    return {
      ok: true, resolved, durationMin, endMin,
      weekdayName: weekdayName(resolved.weekday),
      openMin: dayHours.open, closeMin: dayHours.close,
    };
  }

  export function fmtClock(min: number): string {
    let h = Math.floor(min / 60);
    const m = min % 60;
    const mer = h >= 12 ? "PM" : "AM";
    if (h === 0) h = 12;
    else if (h > 12) h -= 12;
    return m === 0 ? `${h} ${mer}` : `${h}:${String(m).padStart(2, "0")} ${mer}`;
  }
  
  export function newConfirmationId(): string {
    return "SPA-" + Math.random().toString(36).slice(2, 7).toUpperCase();
  }