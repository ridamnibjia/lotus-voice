export type Outcome = 'booked' | 'inquiry' | 'abandoned' | 'escalated';
export interface CallTurn { role: 'user' | 'assistant'; text: string; ts: number; }
export interface CallRecord {
  id: string; tenantId: string; startedAt: number; endedAt?: number;
  transcript: CallTurn[]; outcome?: Outcome; summary?: string;
}

export class CallStore {
  private calls = new Map<string, CallRecord>();
  start(tenantId: string): CallRecord {
    const rec: CallRecord = { id: `call-${Date.now()}`, tenantId, startedAt: Date.now(), transcript: [] };
    this.calls.set(rec.id, rec);
    return rec;
  }
  addTurn(id: string, role: 'user' | 'assistant', text: string) {
    this.calls.get(id)?.transcript.push({ role, text, ts: Date.now() });
  }
  finish(id: string, outcome: Outcome, summary?: string) {
    const rec = this.calls.get(id);
    if (rec) { rec.endedAt = Date.now(); rec.outcome = outcome; rec.summary = summary; }
  }
  list(): CallRecord[] { return [...this.calls.values()]; }
}

export const callStore = new CallStore(); // demo singleton; per-tenant DB later
