import { describe, it, expect } from 'vitest';
import { CallStore } from '../src/agent/call-store.js';

describe('call store', () => {
  it('captures a transcript and finishes with an outcome', () => {
    const s = new CallStore();
    const c = s.start('lotus');
    s.addTurn(c.id, 'assistant', 'Hi, thanks for calling Lotus.');
    s.addTurn(c.id, 'user', 'I want a facial Tuesday.');
    s.finish(c.id, 'booked', 'Caller booked a facial.');
    const rec = s.list()[0];
    expect(rec.transcript.length).toBe(2);
    expect(rec.outcome).toBe('booked');
    expect(rec.endedAt).toBeTruthy();
  });
});
