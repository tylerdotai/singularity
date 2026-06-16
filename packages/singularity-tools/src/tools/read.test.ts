import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import type { ToolContext } from '../types.js';

const CTX: ToolContext = {
  sessionID: 'test-session',
  agent: 'test-agent',
  assistantMessageID: 'test-msg',
  toolCallID: 'test-call',
};

describe('read tool', () => {
  const tmp: string[] = [];
  afterEach(async () => {
    await Promise.all(tmp.map((p) => rm(p).catch(() => {})));
    tmp.length = 0;
  });

  async function tmpfile(content: string): Promise<string> {
    const dir = await mkdtemp('/tmp/read-test-');
    const path = join(dir, 'file.txt');
    await writeFile(path, content);
    tmp.push(dir);
    return path;
  }

  test('reads entire file', async () => {
    const { TOOL } = await import('./read.js');
    const path = await tmpfile('hello\nworld');
    const result = await TOOL.execute({ path }, CTX);
    expect(result.result.type).toBe('json');
    const val = (result.result as unknown as { type: 'string'; value: unknown })
      .value as {
      content: string;
    };
    expect(val.content).toBe('hello\nworld');
  });

  test('reads with start line', async () => {
    const { TOOL } = await import('./read.js');
    const path = await tmpfile('line1\nline2\nline3');
    const result = await TOOL.execute({ path, start: 2 }, CTX);
    expect(result.result.type).toBe('json');
    const val = (result.result as unknown as { type: 'string'; value: unknown })
      .value as {
      content: string;
    };
    expect(val.content).toContain('line2');
  });

  test('reads with limit', async () => {
    const { TOOL } = await import('./read.js');
    const path = await tmpfile('line1\nline2\nline3\nline4\nline5');
    const result = await TOOL.execute({ path, start: 1, limit: 2 }, CTX);
    expect(result.result.type).toBe('json');
    const val = (result.result as unknown as { type: 'string'; value: unknown })
      .value as {
      content: string;
    };
    expect(val.content.split('\n')).toHaveLength(2);
  });

  test('returns error for missing file', async () => {
    const { TOOL } = await import('./read.js');
    const result = await TOOL.execute({ path: '/nonexistent/file.txt' }, CTX);
    expect(result.result.type).toBe('error');
  });

  test('returns truncated flag for large file', async () => {
    const { TOOL } = await import('./read.js');
    const path = await tmpfile('x'.repeat(2_000_000));
    const result = await TOOL.execute({ path }, CTX);
    expect(result.result.type).toBe('json');
    const val = (result.result as unknown as { type: 'string'; value: unknown })
      .value as {
      truncated: boolean;
    };
    expect(val.truncated).toBe(true);
  });

  test('returns lineCount and charCount', async () => {
    const { TOOL } = await import('./read.js');
    const path = await tmpfile('abc\ndef');
    const result = await TOOL.execute({ path }, CTX);
    expect(result.result.type).toBe('json');
    const val = (result.result as unknown as { type: 'string'; value: unknown })
      .value as {
      lineCount: number;
      charCount: number;
    };
    expect(val.lineCount).toBe(2);
    expect(val.charCount).toBe(7);
  });
});
