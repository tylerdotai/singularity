import { describe, expect, test } from 'vitest';
import type { ToolContext } from '../types.js';

const CTX: ToolContext = {
  sessionID: 'test-session',
  agent: 'test-agent',
  assistantMessageID: 'test-msg',
  toolCallID: 'test-call',
};

describe('delegate_task tool', () => {
  test('has correct metadata', async () => {
    const { TOOL } = await import('./delegate.js');
    expect(TOOL.name).toBe('delegate_task');
    expect(TOOL.riskScore).toBe('MEDIUM');
  });

  test('creates task with required goal', async () => {
    const { TOOL } = await import('./delegate.js');
    const result = await TOOL.execute(
      { goal: 'Write unit tests for the auth module' },
      CTX
    );
    expect(result.result.type).toBe('json');
    const val = (result.result as unknown as { type: 'string'; value: unknown })
      .value as {
      taskId: string;
      status: string;
    };
    expect(val.taskId).toMatch(/^task_\d+_/);
    expect(val.status).toBe('pending');
  });

  test('creates task with all optional params', async () => {
    const { TOOL } = await import('./delegate.js');
    const result = await TOOL.execute(
      {
        goal: 'Review the PR',
        context: 'PR #123 adds login functionality',
        allowedTools: ['Read', 'Bash'],
        maxTurns: 5,
      },
      CTX
    );
    expect(result.result.type).toBe('json');
  });

  test('throws validation error for missing goal', async () => {
    const { TOOL } = await import('./delegate.js');
    await expect(TOOL.execute({}, CTX)).rejects.toThrow();
  });

  test('throws validation error for maxTurns out of range', async () => {
    const { TOOL } = await import('./delegate.js');
    await expect(
      TOOL.execute({ goal: 'Test', maxTurns: 200 }, CTX)
    ).rejects.toThrow();
  });
});
