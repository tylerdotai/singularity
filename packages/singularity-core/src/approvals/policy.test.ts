import {
  ApprovalPolicy,
  type PolicyContext,
  type PolicyRule,
} from './policy.ts';

const policy = new ApprovalPolicy();

const emptyContext = (projectId = 'test-project'): PolicyContext => ({
  projectId,
  savedRules: [],
  globalRules: [],
});

describe('ApprovalPolicy', () => {
  test('safe read is allowed by default', () => {
    const result = policy.evaluate('read:file', emptyContext());
    expect(result.decision).toBe('allow');
  });

  test('risky shell asks by default', () => {
    const result = policy.evaluate('bash:shell', emptyContext());
    expect(result.decision).toBe('ask');
  });

  test('delete asks and prefers trash', () => {
    const result = policy.evaluate('delete:file', emptyContext());
    expect(result.decision).toBe('ask');
    expect(result.preferredAction).toBe('bash:trash');
  });

  test('external mutation asks even with a saved allow', () => {
    const context: PolicyContext = {
      projectId: 'project-a',
      savedRules: [{ pattern: 'network:fetch', decision: 'allow' }],
      globalRules: [],
    };
    const result = policy.evaluate('network:fetch', context);
    expect(result.decision).toBe('ask');
  });

  test('global deny wins over default allow', () => {
    const context: PolicyContext = {
      projectId: 'project-a',
      savedRules: [],
      globalRules: [{ pattern: 'read:file', decision: 'deny' }],
    };
    const result = policy.evaluate('read:file', context);
    expect(result.decision).toBe('deny');
  });

  test('saved allow is project-scoped', () => {
    // We use 'bash:shell' (default: 'ask') instead of 'read:file' (default: 'allow')
    // so the project-scoping is visible in the decision field: removing the saved
    // rule must flip the outcome from 'allow' to 'ask'.
    const allowBash: PolicyRule = { pattern: 'bash:shell', decision: 'allow' };

    const ctxProjectA: PolicyContext = {
      projectId: 'project-a',
      savedRules: [allowBash],
      globalRules: [],
    };
    const resultA = policy.evaluate('bash:shell', ctxProjectA);
    expect(resultA.decision).toBe('allow');

    // Project B has the same action but no saved rule → default 'ask'
    const ctxProjectB: PolicyContext = {
      projectId: 'project-b',
      savedRules: [],
      globalRules: [],
    };
    const resultB = policy.evaluate('bash:shell', ctxProjectB);
    expect(resultB.decision).toBe('ask');
  });
});
