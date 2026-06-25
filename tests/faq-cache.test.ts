import { describe, it, expect } from 'vitest';
import { buildFaqCache, lookupFaq } from '../src/agent/faq-cache.js';
import { getTenantConfig } from '../src/agent/tenant.js';

describe('faq cache', () => {
  it('answers "list services" and "hours" instantly from config', async () => {
    const cache = buildFaqCache(await getTenantConfig('lotus'));
    expect(lookupFaq(cache, 'what services do you offer')).toMatch(/Swedish/);
    expect(lookupFaq(cache, 'what are your hours')).toMatch(/Mon/);
  });
  it('returns null for non-FAQ (so the LLM handles it)', async () => {
    const cache = buildFaqCache(await getTenantConfig('lotus'));
    expect(lookupFaq(cache, 'can you cure my sciatica')).toBeNull();
  });
});
