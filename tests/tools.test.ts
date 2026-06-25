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
