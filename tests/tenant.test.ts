import { describe, it, expect } from 'vitest';
import { getTenantConfig, servicesAsText, tenantFromKB } from '../src/agent/tenant.js';

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

describe('tenantFromKB (editable KB merge)', () => {
  it('overrides edited fields and falls back for blank ones', () => {
    const t = tenantFromKB({ name: '  Zen Spa  ', phone: '', services: 'Massage ($90)' });
    expect(t.name).toBe('Zen Spa');                // trimmed override
    expect(t.phone).toBe('(415) 555-0142');        // blank → default
    expect(t.address).toBe('1847 Fillmore Street, San Francisco, CA 94115'); // missing → default
    expect(t.servicesText).toBe('Massage ($90)');  // drives the prompt
    expect(t.services.length).toBeGreaterThan(0);  // structured services kept for scheduling
  });
  it('leaves servicesText undefined when services not edited', () => {
    expect(tenantFromKB({ name: 'Zen Spa' }).servicesText).toBeUndefined();
  });
});
