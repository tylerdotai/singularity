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
  return join(tmpdir(), `glob-test-${randomUUID().slice(0, 8)}`);
}

describe('glob tool', () => {
  const tmp: string[] = [];
  afterEach(async () => {
    await Promise.all(
      tmp.map((p) => rm(p, { recursive: true }).catch(() => {}))
    );
    tmp.length = 0;
  });

  async function tmpdir(): Promise<string> {
    const dir = makeTmpDir();
    await mkdir(dir, { recursive: true });
    tmp.push(dir);
    return dir;
  }

  async function setupGlobDir(cwd: string) {
    await mkdir(join(cwd, 'src'), { recursive: true });
    await mkdir(join(cwd, 'src', 'tools'), { recursive: true });
    await writeFile(join(cwd, 'src', 'index.ts'), '// index');
    await writeFile(join(cwd, 'src', 'tools', 'foo.ts'), '// foo');
    await writeFile(join(cwd, 'src', 'tools', 'bar.ts'), '// bar');
    await writeFile(join(cwd, 'README.md'), '# readme');
    await writeFile(join(cwd, 'package.json'), '{}');
    return cwd;
  }

  test('finds .ts files recursively', async () => {
    const { TOOL } = await import('./glob.js');
    const dir = await setupGlobDir(await tmpdir());
    const result = await TOOL.execute({ pattern: '**/*.ts', cwd: dir }, CTX);
    expect(result.result.type).toBe('json');
    const val = (result.result as unknown as { type: 'string'; value: unknown })
      .value as {
      paths: string[];
      count: number;
    };
    expect(val.count).toBeGreaterThanOrEqual(3);
    expect(val.paths.every((p: string) => p.endsWith('.ts'))).toBe(true);
  });

  test('matches non-recursive top-level pattern', async () => {
    const { TOOL } = await import('./glob.js');
    const dir = await setupGlobDir(await tmpdir());
    const result = await TOOL.execute({ pattern: '*.json', cwd: dir }, CTX);
    expect(result.result.type).toBe('json');
    const val = (result.result as unknown as { type: 'string'; value: unknown })
      .value as {
      count: number;
    };
    expect(val.count).toBe(1);
  });

  test('returns empty array for no matches', async () => {
    const { TOOL } = await import('./glob.js');
    const dir = await setupGlobDir(await tmpdir());
    const result = await TOOL.execute({ pattern: '**/*.rb', cwd: dir }, CTX);
    expect(result.result.type).toBe('json');
    const val = (result.result as unknown as { type: 'string'; value: unknown })
      .value as {
      paths: unknown[];
      count: number;
    };
    expect(val.count).toBe(0);
  });
});
