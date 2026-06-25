import type { TenantConfig } from './tenant.js';
import { servicesAsText } from './tenant.js';

// Keyword-triggered exact answers. Only STABLE facts (never availability).
export function buildFaqCache(t: TenantConfig): Map<string, string> {
  const m = new Map<string, string>();
  m.set('services', `We offer ${servicesAsText(t)}`);
  m.set('hours', `Our hours are ${t.hours}.`);
  m.set('address', `We're at ${t.address}.`);
  m.set('phone', `You can reach us at ${t.phone}.`);
  return m;
}

const TRIGGERS: { key: string; words: RegExp }[] = [
  { key: 'services', words: /\b(services?|offer|treatments?|list|menu)\b/i },
  { key: 'hours', words: /\b(hours?|open|close|closing|timing)\b/i },
  { key: 'address', words: /\b(address|located|location|where are you|directions?)\b/i },
  { key: 'phone', words: /\b(phone|number|call you)\b/i },
];

export function lookupFaq(cache: Map<string, string>, text: string): string | null {
  for (const { key, words } of TRIGGERS) {
    if (words.test(text) && cache.has(key)) return cache.get(key)!;
  }
  return null;
}
