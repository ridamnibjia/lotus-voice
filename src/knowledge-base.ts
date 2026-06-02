/**
 * KNOWLEDGE BASE — edit ONLY this file to change the spa.
 * The agent answers strictly from what's here. Nothing else needs to change.
 */

export const SPA = {
  name: "Lotus Day Spa",
  address: "1847 Fillmore Street, San Francisco, CA 94115",
  phone: "(415) 555-0142",
  timezone: "America/Los_Angeles",
};

export const HOURS = {
  monday: "10:00 AM – 7:00 PM",
  tuesday: "10:00 AM – 7:00 PM",
  wednesday: "10:00 AM – 7:00 PM",
  thursday: "10:00 AM – 8:00 PM",
  friday: "10:00 AM – 8:00 PM",
  saturday: "9:00 AM – 6:00 PM",
  sunday: "11:00 AM – 4:00 PM",
};

export const SERVICES = [
  { name: "Swedish Massage", duration: "60 / 90 min", price: "$120 / $170" },
  { name: "Deep Tissue Massage", duration: "60 / 90 min", price: "$140 / $195" },
  { name: "Hot Stone Massage", duration: "75 min", price: "$165" },
  { name: "Aromatherapy Massage", duration: "60 min", price: "$135" },
  { name: "Signature Lotus Facial", duration: "60 min", price: "$150" },
  { name: "Express Glow Facial", duration: "30 min", price: "$85" },
  { name: "Couples Massage", duration: "60 min", price: "$240 for two" },
];

export const POLICIES = [
  "Arrive 15 minutes early on your first visit for intake.",
  "Cancellations need 24 hours notice or a 50% fee applies.",
  "Gratuity is not included in listed prices.",
  "Gift cards available in any amount.",
  "Limited street parking; a paid garage is one block away on Geary.",
];

/** Renders the KB into the prompt. Edit the data above, not this function. */
export function renderKnowledgeBase(): string {
  const hours = Object.entries(HOURS)
    .map(([d, h]) => `  - ${d[0].toUpperCase() + d.slice(1)}: ${h}`)
    .join("\n");
  const services = SERVICES.map(
    (s) => `  - ${s.name} (${s.duration}): ${s.price}`
  ).join("\n");
  const policies = POLICIES.map((p) => `  - ${p}`).join("\n");

  return `BUSINESS: ${SPA.name}
ADDRESS: ${SPA.address}
PHONE: ${SPA.phone}
TIMEZONE: Pacific Time

HOURS:
${hours}

SERVICES & PRICING:
${services}

POLICIES:
${policies}`;
}