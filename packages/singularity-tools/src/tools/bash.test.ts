import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { makeTool } from '../registry.js';
import type { ToolContext } from '../types.js';

const CTX: ToolContext = {
  sessionID: 'test-session',
  agent: 'test-agent',
  assistantMessageID: 'test-msg',
  toolCallID: 'test-call',
};

// We can't fully test bash without a shell, but we can test input validation,
// path traversal blocking, and the tool's response shape.

describe('bash tool', () => {
  test('bash tool has correct metadata', async () => {
    const { TOOL } = await import('./bash.js');
    expect(TOOL.name).toBe('bash');
    expect(TOOL.riskScore).toBe('HIGH');
    expect(TOOL.approvalRequired).toBe(true);
  });

  test('bash tool executes echo and returns exitCode 0', async () => {
    const { TOOL } = await import('./bash.js');
    const result = await TOOL.execute({ command: 'echo hello' }, CTX);
    expect(result.result.type).toBe('json');
    const val = (result.result as unknown as { type: 'string'; value: unknown })
      .value as {
      exitCode: number;
      output: string;
    };
    expect(val.exitCode).toBe(0);
    expect(val.output.trim()).toBe('hello');
  });

  test('bash tool returns non-zero exitCode on failure', async () => {
    const { TOOL } = await import('./bash.js');
    const result = await TOOL.execute({ command: 'exit 42' }, CTX);
    expect(result.result.type).toBe('json');
    const val = (result.result as unknown as { type: 'string'; value: unknown })
      .value as {
      exitCode: number;
    };
    expect(val.exitCode).toBe(42);
  });

  test('bash tool accepts workdir option', async () => {
    const { TOOL } = await import('./bash.js');
    const result = await TOOL.execute({ command: 'pwd', workdir: '/tmp' }, CTX);
    expect(result.result.type).toBe('json');
    const val = (result.result as unknown as { type: 'string'; value: unknown })
      .value as {
      cwd: string;
    };
    expect(val.cwd).toContain('tmp');
  });

  test('bash tool times out and returns timeout: true', async () => {
    const { TOOL } = await import('./bash.js');
    const result = await TOOL.execute(
      { command: 'sleep 10', timeout: 100 },
      CTX
    );
    expect(result.result.type).toBe('json');
    const val = (result.result as unknown as { type: 'string'; value: unknown })
      .value as {
      timeout: boolean;
      exitCode: number;
    };
    expect(val.timeout).toBe(true);
    expect(val.exitCode).toBe(-1);
  });

  test('bash tool returns truncated flag for large output', async () => {
    const { TOOL } = await import('./bash.js');
    // seq 1 2000000 outputs 2M newlines (~8MB), way over the 1MB truncation limit
    const result = await TOOL.execute({ command: 'seq 1 2000000' }, CTX);
    expect(result.result.type).toBe('json');
    const val = (result.result as unknown as { type: 'string'; value: unknown })
      .value as {
      truncated: boolean;
      output: string;
    };
    expect(val.truncated).toBe(true);
    expect(val.output.length).toBe(1_000_000);
  });
});
