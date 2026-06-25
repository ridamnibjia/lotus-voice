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
