import { describe, expect, it } from 'bun:test';

import {
  DEFAULT_SUBAGENT_MAX_TURNS,
  normalizeSubagentTaskContract,
  type SubagentTaskResult,
} from './index.ts';

describe('SubagentTaskContract', () => {
  it('normalizes a minimal contract with deterministic defaults', () => {
    const contract = normalizeSubagentTaskContract({
      goal: 'Review the implementation',
      context: 'Check the code for scope drift.',
    });

    expect(contract.id).toMatch(/^subtask_[0-9a-f]{32}$/);
    expect(contract.goal).toBe('Review the implementation');
    expect(contract.context.summary).toBe('Check the code for scope drift.');
    expect(contract.allowedTools).toEqual([]);
    expect(contract.modelPolicy).toEqual({});
    expect(contract.workIsolation).toEqual({ kind: 'none' });
    expect(contract.resultSchema).toEqual({ kind: 'text' });
    expect(contract.maxTurns).toBe(DEFAULT_SUBAGENT_MAX_TURNS);
  });

  it('preserves a fully populated contract', () => {
    const contract = normalizeSubagentTaskContract({
      id: 'subtask_manual',
      goal: 'Implement a bounded reviewer',
      context: {
        summary: 'Use the profile subsystem as context only.',
        references: [
          {
            kind: 'file',
            value: 'packages/singularity-core/src/profiles/index.ts',
            description: 'profile public surface',
          },
        ],
      },
      allowedTools: ['read:file', 'bash:shell'],
      modelPolicy: {
        provider: 'provider-neutral',
        model: 'fast-reviewer',
        reasoningEffort: 'medium',
        temperature: 0.2,
      },
      workIsolation: {
        kind: 'worktree',
        basePath: '/tmp/project',
        branchName: 'review-branch',
        reuseExisting: false,
      },
      resultSchema: {
        kind: 'json',
        requiredFields: ['summary', 'verdict'],
      },
      maxTurns: 7,
      profileId: 'prof_default',
      parentSessionId: 'session_parent',
      agentId: 'agent_reviewer',
      reviewerRole: 'scope-reviewer',
      metadata: { critical: true, attempt: 1, note: 'phase-6.2' },
    });

    expect(contract.id).toBe('subtask_manual');
    expect(contract.context.references?.[0]?.kind).toBe('file');
    expect(contract.allowedTools).toEqual(['read:file', 'bash:shell']);
    expect(contract.modelPolicy.model).toBe('fast-reviewer');
    expect(contract.workIsolation.kind).toBe('worktree');
    expect(contract.resultSchema.kind).toBe('json');
    expect(contract.maxTurns).toBe(7);
    expect(contract.profileId).toBe('prof_default');
    expect(contract.metadata?.attempt).toBe(1);
  });

  it('returns cloned arrays and objects instead of mutating caller input', () => {
    const input = {
      goal: 'Clone inputs',
      context: {
        summary: 'Verify clone behavior.',
        references: [{ kind: 'file' as const, value: 'a.ts' }],
      },
      allowedTools: ['read:file'],
      resultSchema: { kind: 'json' as const, requiredFields: ['summary'] },
    };

    const contract = normalizeSubagentTaskContract(input);

    expect(contract.context).not.toBe(input.context);
    expect(contract.context.references).not.toBe(input.context.references);
    expect(contract.allowedTools).not.toBe(input.allowedTools);
    expect(contract.resultSchema).not.toBe(input.resultSchema);
  });

  it('models a serializable structured result', () => {
    const result: SubagentTaskResult = {
      contractId: 'subtask_done',
      status: 'completed',
      summary: 'All checks passed.',
      artifacts: [{ kind: 'summary', value: 'APPROVE' }],
      metadata: { durationMs: 42 },
    };

    const roundTrip = JSON.parse(JSON.stringify(result)) as SubagentTaskResult;

    expect(roundTrip.contractId).toBe('subtask_done');
    expect(roundTrip.status).toBe('completed');
    expect(roundTrip.artifacts[0]?.value).toBe('APPROVE');
    expect(roundTrip.metadata?.durationMs).toBe(42);
  });
});
