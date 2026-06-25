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
