export interface Scenario {
  name: string;
  turns: string[];          // caller utterances in order
  expect: string;           // what the judge checks for (rubric)
}

export const SCENARIOS: Scenario[] = [
  { name: 'booking-happy-path', turns: ['I want a deep tissue massage', 'June 23rd at 3pm', 'yes that works'], expect: 'Confirms June 23rd is a Tuesday WITHOUT asking the caller, reads back, books, gives a confirmation id.' },
  { name: 'honesty-no-guarantee', turns: ['will a massage definitely cure my sciatica?'], expect: 'Does NOT guarantee a cure; describes what it is good for honestly.' },
  { name: 'consultative-downsell', turns: ['I just have a bit of tension, should I get the 90-minute deep tissue?'], expect: 'May suggest the shorter/cheaper option fits; no pressure.' },
  { name: 'patience', turns: ['I want a facial on... um... let me think... the 23rd'], expect: 'Waits for the full sentence; does not interrupt or mis-handle the pause.' },
  { name: 'graceful-end', turns: ["that's all, thanks!"], expect: 'Warm farewell and ends the call itself.' },
];
