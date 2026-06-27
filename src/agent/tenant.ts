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
  servicesText?: string; // free-text override for the prompt (from the editable KB)
}

// Fields the browser KB panel can edit. All optional — blanks fall back to LOTUS.
export interface KBInput {
  name?: string;
  address?: string;
  phone?: string;
  hours?: string;
  services?: string;
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
    {
      name: 'Swedish Massage',
      description: 'A full-body massage using long, flowing strokes, kneading, and gentle pressure with warm oil. Pressure is light to moderate — never intense. The room is quiet, dimly lit, and warm. Most clients feel deeply relaxed or even fall asleep. Sessions run 60 minutes. Recommend this to first-time spa visitors, anyone who feels stressed, anxious, or burned out, people with trouble sleeping, or callers who just want to feel good without targeting specific pain. It is the gentler, more affordable option compared to Deep Tissue.',
      goodFor: 'stress relief, anxiety, sleep problems, general relaxation, first-time spa visitors, or anyone who wants a nurturing full-body experience without intense pressure. Not the right fit if the caller has deep muscle knots, sports injuries, or chronic tension in specific areas — steer those callers to Deep Tissue instead.',
      durationMin: 60,
      price: 120,
    },
    {
      name: 'Deep Tissue Massage',
      description: 'A 90-minute massage using firm, slow strokes that reach deeper muscle layers and connective tissue. The therapist focuses on specific problem areas — shoulders, neck, lower back, or wherever the caller holds tension. Pressure is noticeably stronger than Swedish; some clients feel mild discomfort in very tight spots, which is normal and temporary. Always recommend this to callers who mention chronic back or neck pain, sitting at a desk all day, recurring knots, athletic recovery, or anyone who says Swedish "never feels like enough." It costs twenty dollars more than Swedish and runs 30 minutes longer, so acknowledge that trade-off honestly when relevant.',
      goodFor: 'chronic muscle tension, knots, back pain, neck and shoulder tightness, desk workers, athletes, and anyone who needs real therapeutic pressure rather than general relaxation. Not ideal for first-timers who are unsure of their pressure tolerance — if they seem hesitant, suggest they start with Swedish.',
      durationMin: 90,
      price: 140,
    },
    {
      name: 'Facial',
      description: 'A 60-minute professional skin treatment: double cleanse, gentle steam, light exfoliation, a targeted mask (hydrating, brightening, or calming depending on skin type), and finishing moisturizer with SPF. The esthetician customizes the mask and serums to the client\'s skin on the day. Skin looks visibly refreshed and glowing immediately after. Clients often describe it as relaxing as a massage. Recommend this to callers concerned about dull, dry, or tired-looking skin, anyone with an upcoming event or photo, people who haven\'t had a professional skin treatment in a while, or those looking for a self-care treat that also addresses their skin. It is the highest-priced service at one hundred fifty dollars.',
      goodFor: 'dull or dehydrated skin, pre-event glow, general skin maintenance, anti-aging concerns, and callers who want both relaxation and a visible skin result in one session. If a caller mentions severe active acne or a skin condition, gently note that a consultation with their dermatologist may be worthwhile alongside spa facials — be honest, not dismissive.',
      durationMin: 60,
      price: 150,
    },
  ],
};

// Single-tenant for the demo. Seam for a per-tenant DB later.
export async function getTenantConfig(_id: string): Promise<TenantConfig> {
  return LOTUS;
}

// Merge the browser's edited KB over the Lotus defaults. Blank/whitespace fields
// keep the default. `services` (if edited) becomes the spoken grounding via
// servicesText; the structured LOTUS.services stay put so scheduling can still
// look up durations by name (scheduling.ts falls back to a default duration for
// names it doesn't recognize).
// ponytail: edits only ground the prompt; they don't change scheduling durations.
// Add structured service editing if/when someone needs per-service durations live.
export function tenantFromKB(kb: KBInput): TenantConfig {
  const pick = (v: string | undefined, fallback: string) =>
    v && v.trim() ? v.trim() : fallback;
  return {
    ...LOTUS,
    name: pick(kb.name, LOTUS.name),
    address: pick(kb.address, LOTUS.address),
    phone: pick(kb.phone, LOTUS.phone),
    hours: pick(kb.hours, LOTUS.hours),
    servicesText: kb.services && kb.services.trim() ? kb.services.trim() : undefined,
  };
}

export function servicesAsText(t: TenantConfig): string {
  return t.services
    .map((s) => `${s.name} ($${s.price}, ${s.durationMin} minutes) — ${s.description} Good for ${s.goodFor}.`)
    .join(' ');
}
