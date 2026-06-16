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
  return join(tmpdir(), `applypatch-test-${randomUUID().slice(0, 8)}`);
}

describe('applypatch tool', () => {
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

  test('applies single patch to single file', async () => {
    const { TOOL } = await import('./applypatch.js');
    const path1 = await tmpfile('line1\nline2\nline3\n');
    const path2 = await tmpfile('other\n');
    const result = await TOOL.execute(
      {
        patches: [
          {
            path: path1,
            patch: '@@ -1,3 +1,3 @@\n-line1\n line2\n line3\n+newline\n',
          },
        ],
      },
      CTX
    );
    expect(result.result.type).toBe('json');
    const val = (result.result as unknown as { type: 'string'; value: unknown })
      .value as {
      applied: number;
    };
    expect(val.applied).toBe(1);
    expect(await Bun.file(path1).text()).not.toBe('line1\nline2\nline3\n');
    expect(await Bun.file(path2).text()).toBe('other\n');
  });

  test('applies multiple patches', async () => {
    const { TOOL } = await import('./applypatch.js');
    const path1 = await tmpfile('file1\n');
    const path2 = await tmpfile('file2\n');
    const result = await TOOL.execute(
      {
        patches: [
          {
            path: path1,
            patch: '--- file1\n+++ file1\n@@ -1 +1 @@\n file1\n+extra1\n',
          },
          {
            path: path2,
            patch: '--- file2\n+++ file2\n@@ -1 +1 @@\n file2\n+extra2\n',
          },
        ],
      },
      CTX
    );
    expect(result.result.type).toBe('json');
    const val = (result.result as unknown as { type: 'string'; value: unknown })
      .value as {
      applied: number;
    };
    expect(val.applied).toBe(2);
  });

  test('returns failed entry for nonexistent file without create', async () => {
    const { TOOL } = await import('./applypatch.js');
    const result = await TOOL.execute(
      {
        patches: [
          {
            path: '/tmp/nonexistent-xyz-applypatch.txt',
            patch: '--- x\n+++ x\n@@ -1 +1 @@\n a\n+b\n',
          },
        ],
      },
      CTX
    );
    expect(result.result.type).toBe('json');
    const val = (result.result as unknown as { type: 'string'; value: unknown })
      .value as {
      applied: number;
      failed: unknown[];
    };
    expect(val.applied).toBe(0);
    expect((val.failed as { error: string }[])[0].error).toBe('File not found');
  });

  test('creates file when create: true', async () => {
    const { TOOL } = await import('./applypatch.js');
    const dir = makeTmpDir();
    await mkdir(dir, { recursive: true });
    const path = join(dir, 'newfile.txt');
    tmp.push(dir);
    const result = await TOOL.execute(
      {
        patches: [{ path, patch: '@@ -0,0 +1 @@\n+created\n', create: true }],
      },
      CTX
    );
    expect(result.result.type).toBe('json');
    const val = (result.result as unknown as { type: 'string'; value: unknown })
      .value as {
      applied: number;
    };
    expect(val.applied).toBe(1);
    expect(await Bun.file(path).text()).not.toBe('');
  });
});
