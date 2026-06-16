import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import type { ToolContext } from '../types.js';

const CTX: ToolContext = {
  sessionID: 'test-session',
  agent: 'test-agent',
  assistantMessageID: 'test-msg',
  toolCallID: 'test-call',
};

function makeTmpDir(): string {
  return join(tmpdir(), `grep-test-${randomUUID().slice(0, 8)}`);
}

describe('grep tool', () => {
  const tmp: string[] = [];
  afterEach(async () => {
    await Promise.all(
      tmp.map((p) => rm(p, { recursive: true }).catch(() => {}))
    );
    tmp.length = 0;
  });

  async function tmpfile(content: string): Promise<string> {
    const dir = makeTmpDir();
    await mkdir(dir, { recursive: true });
    const path = join(dir, 'file.txt');
    await writeFile(path, content);
    tmp.push(dir);
    return path;
  }

  test('finds matching lines', async () => {
    const { TOOL } = await import('./grep.js');
    const path = await tmpfile('foo\nbar\nfoo\n');
    const result = await TOOL.execute({ pattern: 'foo', path }, CTX);
    expect(result.result.type).toBe('json');
    const val = (result.result as unknown as { type: 'string'; value: unknown })
      .value as {
      matches: unknown[];
      total: number;
    };
    expect(val.total).toBeGreaterThanOrEqual(2);
  });

  test('returns empty for no matches', async () => {
    const { TOOL } = await import('./grep.js');
    const path = await tmpfile('hello world');
    const result = await TOOL.execute({ pattern: 'xyz', path }, CTX);
    expect(result.result.type).toBe('json');
    const val = (result.result as unknown as { type: 'string'; value: unknown })
      .value as {
      total: number;
    };
    expect(val.total).toBe(0);
  });

  test('returns error for unreadable path', async () => {
    const { TOOL } = await import('./grep.js');
    const result = await TOOL.execute(
      { pattern: 'foo', path: '/nonexistent/file.txt' },
      CTX
    );
    expect(result.result.type).toBe('error');
  });

  test('context option returns surrounding lines', async () => {
    const { TOOL } = await import('./grep.js');
    const path = await tmpfile('line1\nline2\nline3\nline4\n');
    const result = await TOOL.execute(
      { pattern: 'line3', path, context: 1 },
      CTX
    );
    expect(result.result.type).toBe('json');
    const val = (result.result as unknown as { type: 'string'; value: unknown })
      .value as {
      matches: unknown[];
    };
    expect(
      (val.matches as { line: number }[]).some(
        (m) => m.line === 2 || m.line === 4
      )
    ).toBe(true);
  });

  test('regex patterns work', async () => {
    const { TOOL } = await import('./grep.js');
    const path = await tmpfile('abc123\ndef456\nabc789\n');
    const result = await TOOL.execute({ pattern: 'abc\\d+', path }, CTX);
    expect(result.result.type).toBe('json');
    const val = (result.result as unknown as { type: 'string'; value: unknown })
      .value as {
      total: number;
    };
    expect(val.total).toBeGreaterThanOrEqual(2);
  });
});
