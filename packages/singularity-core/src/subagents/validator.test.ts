import { describe, expect, it } from 'bun:test';

import {
  MAX_SUBAGENT_CONTEXT_LENGTH,
  MAX_SUBAGENT_GOAL_LENGTH,
  normalizeSubagentTaskContract,
  SubagentContractError,
  validateSubagentTaskContract,
} from './index.ts';

function expectReason(fn: () => void, reason: SubagentContractError['reason']) {
  let caught: unknown;
  try {
    fn();
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(SubagentContractError);
  expect((caught as SubagentContractError).reason).toBe(reason);
}

describe('SubagentContractValidator', () => {
  it('validates a complete normalized contract', () => {
    const contract = normalizeSubagentTaskContract({
      goal: 'Summarize findings',
      context: 'Read the changed files and summarize.',
      allowedTools: ['read:file'],
      modelPolicy: { provider: 'local', model: 'reviewer', temperature: 0 },
      workIsolation: { kind: 'sandbox', rootPath: '/tmp/sandbox' },
      resultSchema: { kind: 'json', requiredFields: ['summary'] },
      maxTurns: 3,
    });

    expect(() => validateSubagentTaskContract(contract)).not.toThrow();
  });

  it('rejects empty and too-long goals', () => {
    expectReason(
      () => normalizeSubagentTaskContract({ goal: '   ', context: 'ctx' }),
      'goal_empty'
    );
    expectReason(
      () =>
        normalizeSubagentTaskContract({
          goal: 'g'.repeat(MAX_SUBAGENT_GOAL_LENGTH + 1),
          context: 'ctx',
        }),
      'goal_too_long'
    );
  });

  it('rejects empty and too-long context summaries', () => {
    expectReason(
      () => normalizeSubagentTaskContract({ goal: 'goal', context: '   ' }),
      'context_empty'
    );
    expectReason(
      () =>
        normalizeSubagentTaskContract({
          goal: 'goal',
          context: 'c'.repeat(MAX_SUBAGENT_CONTEXT_LENGTH + 1),
        }),
      'context_too_long'
    );
  });

  it('rejects invalid context references', () => {
    expectReason(
      () =>
        normalizeSubagentTaskContract({
          goal: 'goal',
          context: {
            summary: 'ctx',
            references: [{ kind: 'file', value: '   ' }],
          },
        }),
      'context_reference_invalid'
    );
  });

  it('rejects invalid and duplicate allowed tools', () => {
    expectReason(
      () =>
        normalizeSubagentTaskContract({
          goal: 'goal',
          context: 'ctx',
          allowedTools: ['bad tool'],
        }),
      'allowed_tool_invalid'
    );
    expectReason(
      () =>
        normalizeSubagentTaskContract({
          goal: 'goal',
          context: 'ctx',
          allowedTools: ['read:file', 'read:file'],
        }),
      'allowed_tool_duplicate'
    );
  });

  it('rejects invalid model policy', () => {
    expectReason(
      () =>
        normalizeSubagentTaskContract({
          goal: 'goal',
          context: 'ctx',
          modelPolicy: { provider: '   ' },
        }),
      'model_policy_invalid'
    );
    expectReason(
      () =>
        normalizeSubagentTaskContract({
          goal: 'goal',
          context: 'ctx',
          modelPolicy: { temperature: 3 },
        }),
      'model_policy_invalid'
    );
  });

  it('rejects invalid work isolation', () => {
    expectReason(
      () =>
        normalizeSubagentTaskContract({
          goal: 'goal',
          context: 'ctx',
          workIsolation: { kind: 'worktree', basePath: '   ' },
        }),
      'work_isolation_invalid'
    );
    expectReason(
      () =>
        validateSubagentTaskContract({
          id: 'subtask_bad',
          goal: 'goal',
          context: { summary: 'ctx' },
          allowedTools: [],
          modelPolicy: {},
          workIsolation: { kind: 'vm' } as never,
          resultSchema: { kind: 'text' },
          maxTurns: 1,
        }),
      'work_isolation_invalid'
    );
  });

  it('rejects invalid result schemas', () => {
    expectReason(
      () =>
        normalizeSubagentTaskContract({
          goal: 'goal',
          context: 'ctx',
          resultSchema: { kind: 'json', requiredFields: ['bad-field'] },
        }),
      'result_schema_invalid'
    );
    expectReason(
      () =>
        normalizeSubagentTaskContract({
          goal: 'goal',
          context: 'ctx',
          resultSchema: {
            kind: 'json',
            requiredFields: ['summary', 'summary'],
          },
        }),
      'result_schema_invalid'
    );
  });

  it('rejects invalid max turns values', () => {
    for (const maxTurns of [0, 101, 1.5, Number.POSITIVE_INFINITY]) {
      expectReason(
        () =>
          normalizeSubagentTaskContract({
            goal: 'goal',
            context: 'ctx',
            maxTurns,
          }),
        'max_turns_invalid'
      );
    }
  });
});
