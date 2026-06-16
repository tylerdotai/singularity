import { describe, expect, test } from 'vitest';
import type { ToolContext } from '../types.js';

const CTX: ToolContext = {
  sessionID: 'test-session',
  agent: 'test-agent',
  assistantMessageID: 'test-msg',
  toolCallID: 'test-call',
};

describe('execute_code tool', () => {
  test('has correct metadata', async () => {
    const { TOOL } = await import('./execute-code.js');
    expect(TOOL.name).toBe('execute_code');
    expect(TOOL.riskScore).toBe('MEDIUM');
  });

  test('accepts valid code with supported language', async () => {
    const { TOOL } = await import('./execute-code.js');
    const result = await TOOL.execute(
      { code: "print('hello')", language: 'python', timeout: 10 },
      CTX
    );
    expect(result.result.type).toBe('json');
    const val = (result.result as unknown as { type: 'string'; value: unknown })
      .value as {
      stdout: string;
      stderr: string;
      exitCode: number;
      wallClockMs: number;
    };
    expect(val.exitCode).toBe(0);
  });

  test('throws validation error for missing code', async () => {
    const { TOOL } = await import('./execute-code.js');
    await expect(TOOL.execute({ language: 'python' }, CTX)).rejects.toThrow();
  });

  test('throws validation error for missing language', async () => {
    const { TOOL } = await import('./execute-code.js');
    await expect(
      TOOL.execute({ code: "print('hello')" }, CTX)
    ).rejects.toThrow();
  });

  test('throws validation error for unsupported language', async () => {
    const { TOOL } = await import('./execute-code.js');
    await expect(
      TOOL.execute({ code: "print('hello')", language: 'cobol' }, CTX)
    ).rejects.toThrow();
  });

  test('throws validation error for timeout out of range', async () => {
    const { TOOL } = await import('./execute-code.js');
    await expect(
      TOOL.execute(
        { code: "print('hello')", language: 'python', timeout: 200 },
        CTX
      )
    ).rejects.toThrow();
  });

  test('accepts all supported languages', async () => {
    const { TOOL } = await import('./execute-code.js');
    const languages = [
      'javascript',
      'typescript',
      'python',
      'bash',
      'shell',
      'json',
      'yaml',
      'sql',
      'rust',
      'go',
    ];
    for (const lang of languages) {
      const result = await TOOL.execute(
        { code: '// code', language: lang },
        CTX
      );
      expect(result.result.type).toBe('json');
    }
  });
});
