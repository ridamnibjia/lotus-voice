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
