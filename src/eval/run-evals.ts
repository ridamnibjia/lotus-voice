import { SCENARIOS } from './scenarios.js';

// Conversational eval: drive the LLM with each scenario, score with an LLM judge.
// For Phase 0 this runner is intentionally thin — the deterministic guards in
// tests/eval-scenarios.test.ts already lock the core behaviors. The model+judge
// wiring is fleshed out once the browser demo is stable (spec §16.3 recursive
// loop); every real-world failure from Task 10's live test gets appended to
// SCENARIOS and becomes a permanent guard.
//
// Wiring sketch for the judge call (Phase 1):
//   1) run the agent's LLM over s.turns with buildSystemPrompt + makeTools (text mode)
//   2) ask a judge model: does the transcript satisfy s.expect? → PASS/FAIL + reason
//   3) print `${s.name}: PASS/FAIL — reason`

async function main() {
  console.log(`[eval] ${SCENARIOS.length} scenarios (Phase 0: deterministic guards live in vitest)\n`);
  for (const s of SCENARIOS) {
    console.log(`[eval] ${s.name}: (judge call TODO) — expects: ${s.expect}`);
  }
}

main();
