export interface Service {
  name: string;
  description: string;   // honest description of what it is
  goodFor: string;       // what it typically helps with (no guarantees)
  durationMin: number;
  price: number;
}

export interface TenantConfig {
  id: string;
  name: string;
  address: string;
  phone: string;
  timezone: string;      // IANA tz, critical for date resolution
  voice: string;         // TTS voice id
  hours: string;         // parsed by scheduling.parseHours
  services: Service[];
}

const LOTUS: TenantConfig = {
  id: 'lotus',
  name: 'Lotus Day Spa',
  address: '1847 Fillmore Street, San Francisco, CA 94115',
  phone: '(415) 555-0142',
  timezone: 'America/Los_Angeles',
  voice: 'aura-2-thalia-en',
  hours: 'Mon-Wed: 10am-7pm, Thu-Fri: 10am-8pm, Sat: 9am-6pm, Sun: 11am-4pm',
  services: [
    { name: 'Swedish Massage', description: 'A gentle full-body massage using long, flowing strokes.', goodFor: 'general relaxation and easing mild tension', durationMin: 60, price: 120 },
    { name: 'Deep Tissue Massage', description: 'Firm pressure targeting deeper muscle layers.', goodFor: 'chronic tightness and knots', durationMin: 90, price: 140 },
    { name: 'Facial', description: 'A cleansing and hydrating skin treatment.', goodFor: 'refreshing and nourishing the skin', durationMin: 60, price: 150 },
  ],
};

// Single-tenant for the demo. Seam for a per-tenant DB later.
export async function getTenantConfig(_id: string): Promise<TenantConfig> {
  return LOTUS;
}

export function servicesAsText(t: TenantConfig): string {
  return t.services
    .map((s) => `${s.name} ($${s.price}, ${s.durationMin} minutes) — ${s.description} Good for ${s.goodFor}.`)
    .join(' ');
}
