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
