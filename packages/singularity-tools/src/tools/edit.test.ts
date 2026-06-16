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
  return join(tmpdir(), `edit-test-${randomUUID().slice(0, 8)}`);
}

describe('edit tool', () => {
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

  test('applies single-line patch', async () => {
    const { TOOL } = await import('./edit.js');
    const path = await tmpfile('old\n');
    const result = await TOOL.execute(
      {
        path,
        patch: '--- file.txt\n+++ file.txt\n@@ -1 +1 @@\n-old\n+new\n',
      },
      CTX
    );
    expect(result.result.type).toBe('json');
    const content = await Bun.file(path).text();
    expect(content).toBe('new\n');
  });

  test('adds new line', async () => {
    const { TOOL } = await import('./edit.js');
    const path = await tmpfile('line1\nline2\n');
    const result = await TOOL.execute(
      {
        path,
        patch:
          '--- file.txt\n+++ file.txt\n@@ -1,2 +1,3 @@\n line1\n line2\n+line3\n',
      },
      CTX
    );
    expect(result.result.type).toBe('json');
    const content = await Bun.file(path).text();
    expect(content).toBe('line1\nline2\nline3\n');
  });

  test('blocks path traversal', async () => {
    const { TOOL } = await import('./edit.js');
    const result = await TOOL.execute(
      {
        path: '/tmp/../../../etc/passwd',
        patch: '--- x\n+++ x\n@@ -1 +1 @@\n old\n+new\n',
      },
      CTX
    );
    expect(result.result.type).toBe('error');
    expect(
      (result.result as unknown as { type: 'string'; value: string }).value
    ).toContain('Path traversal blocked');
  });

  test('returns error for nonexistent file without create flag', async () => {
    const { TOOL } = await import('./edit.js');
    const result = await TOOL.execute(
      {
        path: '/tmp/does-not-exist-xyz.txt',
        patch: '--- x\n+++ x\n@@ -1 +1 @@\n old\n+new\n',
      },
      CTX
    );
    expect(result.result.type).toBe('error');
  });

  test('creates file when create: true', async () => {
    const { TOOL } = await import('./edit.js');
    const dir = makeTmpDir();
    await mkdir(dir, { recursive: true });
    const path = join(dir, 'newfile.txt');
    tmp.push(dir);
    const result = await TOOL.execute(
      {
        path,
        patch: '--- /dev/null\n+++ newfile.txt\n@@ -0,0 +1 @@\n+hello\n',
        create: true,
      },
      CTX
    );
    expect(result.result.type).toBe('json');
    expect(await Bun.file(path).exists()).toBe(true);
    expect(await Bun.file(path).text()).toBe('hello\n');
  });

  test('returns linesChanged count', async () => {
    const { TOOL } = await import('./edit.js');
    const path = await tmpfile('line1\nline2\nline3\n');
    const result = await TOOL.execute(
      {
        path,
        patch:
          '--- file.txt\n+++ file.txt\n@@ -1,3 +1,2 @@\n-line1\n line2\n line3\n',
      },
      CTX
    );
    expect(result.result.type).toBe('json');
    const val = (result.result as unknown as { type: 'string'; value: unknown })
      .value as {
      linesChanged: number;
    };
    expect(val.linesChanged).toBeGreaterThan(0);
  });
});
