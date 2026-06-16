// Phase 4.1 — `risk.ts` unit tests.
//
// Covers the public surface of `risk.ts`:
//   1. `classifyAction` returns the correct `ActionRisk` for every known `ActionClass`
//   2. `defaultDecision` returns the correct `PolicyDecision` for every known `ActionClass`
//   3. `classifyAction` / `defaultDecision` fallback to `'risky'` / `'ask'` for unknown actions
//   4. `preferredAlternative` returns `'bash:trash'` for `'delete:file'`
//   5. `preferredAlternative` returns `undefined` for every other action (known + unknown)
//
// Pure and stateless — no fixtures, no `beforeEach`. Each test exercises a
// top-level function with a direct argument.

import {
  type ActionClass,
  type ActionRisk,
  classifyAction,
  defaultDecision,
  type PolicyDecision,
  preferredAlternative,
} from './risk.ts';

const KNOWN_ACTIONS: ReadonlyArray<{
  readonly action: ActionClass;
  readonly risk: ActionRisk;
  readonly decision: PolicyDecision;
}> = [
  { action: 'read:file', risk: 'safe', decision: 'allow' },
  { action: 'write:file', risk: 'risky', decision: 'ask' },
  { action: 'delete:file', risk: 'destructive', decision: 'ask' },
  { action: 'bash:shell', risk: 'risky', decision: 'ask' },
  { action: 'network:fetch', risk: 'destructive', decision: 'ask' },
  { action: 'bash:trash', risk: 'risky', decision: 'ask' },
];

describe('classifyAction', () => {
  for (const { action, risk } of KNOWN_ACTIONS) {
    it(`returns '${risk}' for '${action}'`, () => {
      expect(classifyAction(action)).toBe(risk);
    });
  }

  it("returns 'risky' for an unknown action", () => {
    expect(classifyAction('unknown:action')).toBe('risky');
  });
});

describe('defaultDecision', () => {
  for (const { action, decision } of KNOWN_ACTIONS) {
    it(`returns '${decision}' for '${action}'`, () => {
      expect(defaultDecision(action)).toBe(decision);
    });
  }

  it("returns 'ask' for an unknown action", () => {
    expect(defaultDecision('unknown:action')).toBe('ask');
  });
});

describe('preferredAlternative', () => {
  it("returns 'bash:trash' for 'delete:file'", () => {
    expect(preferredAlternative('delete:file')).toBe('bash:trash');
  });

  for (const { action } of KNOWN_ACTIONS) {
    if (action === 'delete:file') continue;
    it(`returns undefined for '${action}'`, () => {
      expect(preferredAlternative(action)).toBeUndefined();
    });
  }

  it('returns undefined for an unknown action', () => {
    expect(preferredAlternative('unknown:action')).toBeUndefined();
  });
});
