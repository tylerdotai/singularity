// Phase 5.1 — `WorktreeRunner` unit tests.
//
// The five `test(...)` blocks below are the IMPLEMENTATION_PLAN Task 2.2
// scenarios for Phase 5.1 (worktree runner). Each scenario maps 1:1 to a
// behavior the engine relies on:
//
//   1. creates an isolated worktree, returns metadata with artifacts +
//      worktreePath + branch + baseCommit + wallClockMs
//   2. the derived branch name embeds `state.attempt` (so attempt 2 gives
//      a branch ending in `iter-2`)
//   3. non-git shared workdirs are rejected with `WorktreeError` whose
//      `kind === 'not_a_git_repo'`
//   4. cleanup uses `git worktree remove` / safe path — never plain `rm -rf`
//   5. `preferredBranch` (constructor arg) overrides the derived branch name
//
// Each test gets a fresh temp git repo via `createTempGitRepo()` in
// `beforeEach` (or, for test 3, a fresh non-git dir). Temp dirs are tracked
// in a module-level set and removed in `afterEach`, so tests are
// order-independent and the FS is left clean.
//
// The subprocess under test is the Phase 5.1 placeholder in `worktree.ts`
// (`pwd && git log -1 --format=%s && git status --short`). It must produce
// `[exit=0]` for the metadata checks to be meaningful.

import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ActionResult, LoopState } from 'singularity-loop';

import { WorktreeError, WorktreeRunner } from './worktree.ts';

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

/** Run a subprocess to completion and capture stdout/stderr/exitCode. */
async function run(
  cmd: string[],
  cwd?: string
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn({
    cmd,
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

/** Build a `LoopState` with sensible defaults. `attempt` defaults to 1. */
function state(overrides: Partial<LoopState> = {}): LoopState {
  return {
    goal: 'default goal',
    attempt: 1,
    maxIterations: 5,
    context: {},
    previousFeedback: '',
    history: [],
    ...overrides,
  };
}

/** Module-level set of temp dirs to clean up in `afterEach`. */
const tempDirs = new Set<string>();

/**
 * Create a fresh temp git repo with a single `initial` commit on
 * `master`/`main`. The repo name is unique per call (mkdtemp + suffix).
 */
async function createTempGitRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'singularity-worktree-'));
  tempDirs.add(dir);

  await run(['git', 'init', '-q'], dir);
  // Local config so commits don't fail under `git -c user.email=...`.
  await run(['git', 'config', 'user.email', 'test@example.com'], dir);
  await run(['git', 'config', 'user.name', 'Test User'], dir);
  // Force a deterministic default branch name across git versions.
  await run(['git', 'checkout', '-q', '-b', 'master'], dir);

  await writeFile(join(dir, 'README.md'), '# Test repo\n');
  await run(['git', 'add', 'README.md'], dir);
  await run(['git', 'commit', '-q', '-m', 'initial'], dir);
  return dir;
}

/** Poll `git worktree list` until the path is gone, or `timeoutMs` elapses. */
async function waitForWorktreeRemoval(
  repo: string,
  worktreePath: string,
  timeoutMs = 5000
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { stdout } = await run(['git', '-C', repo, 'worktree', 'list']);
    if (!stdout.includes(worktreePath)) return true;
    await new Promise<void>((r) => setTimeout(r, 50));
  }
  return false;
}

// -----------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------

describe('WorktreeRunner', () => {
  afterEach(async () => {
    // Best-effort cleanup; ignore individual failures so one stuck dir
    // doesn't cascade and fail the whole suite.
    for (const dir of tempDirs) {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
    tempDirs.clear();
  });

  it('creates an isolated worktree and returns the documented metadata', async () => {
    const repo = await createTempGitRepo();
    const runner = new WorktreeRunner(repo);

    const result: ActionResult = await runner.run(
      state({ goal: 'Fix Login Button', attempt: 1 })
    );

    // Subprocess must succeed — output contains git status, commit, and branch info.
    expect(result.output).toContain('(clean)');
    expect(result.output).toContain('commit:');
    expect(result.output).toContain('branch:');

    // All five metadata fields are present and well-typed.
    const meta = result.metadata as {
      artifacts: readonly string[];
      worktreePath: string;
      branch: string;
      baseCommit: string;
      wallClockMs: number;
    };
    expect(typeof meta.worktreePath).toBe('string');
    expect(meta.worktreePath.length).toBeGreaterThan(0);
    expect(meta.worktreePath).toContain('.worktrees');

    expect(typeof meta.branch).toBe('string');
    // Goal "Fix Login Button" → "fix-login-button"; attempt 1 → "iter-1".
    expect(meta.branch).toBe('fix-login-button-iter-1');

    expect(typeof meta.baseCommit).toBe('string');
    // `git rev-parse HEAD` returns a 40-char SHA-1.
    expect(meta.baseCommit).toMatch(/^[0-9a-f]{40}$/);

    expect(typeof meta.wallClockMs).toBe('number');
    expect(meta.wallClockMs).toBeGreaterThanOrEqual(0);

    expect(Array.isArray(meta.artifacts)).toBe(true);
  });

  it('uses the attempt number in derived branch names', async () => {
    const repo = await createTempGitRepo();
    const runner = new WorktreeRunner(repo);

    const result = await runner.run(
      state({ goal: 'Refactor Auth Flow', attempt: 2 })
    );

    const meta = result.metadata as { branch: string };
    // Slug "refactor-auth-flow" + attempt 2 → "refactor-auth-flow-iter-2".
    expect(meta.branch).toBe('refactor-auth-flow-iter-2');
  });

  it('throws WorktreeError(kind="not_a_git_repo") for non-git directories', async () => {
    const nonGitDir = await mkdtemp(join(tmpdir(), 'singularity-not-git-'));
    tempDirs.add(nonGitDir);

    const runner = new WorktreeRunner(nonGitDir);

    let caught: unknown;
    try {
      await runner.run(state({ goal: 'whatever', attempt: 1 }));
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(WorktreeError);
    // `WorktreeError.kind` is the discriminator the engine matches on.
    expect((caught as WorktreeError).kind).toBe('not_a_git_repo');
  });

  it('cleanup uses git worktree remove — never plain rm -rf', async () => {
    const repo = await createTempGitRepo();
    const runner = new WorktreeRunner(repo);

    const result = await runner.run(
      state({ goal: 'Cleanup Probe', attempt: 1 })
    );
    const worktreePath = (result.metadata as { worktreePath: string })
      .worktreePath;

    // Tier 1 (`git worktree remove`) is synchronous-ish; 5s is generous.
    const removed = await waitForWorktreeRemoval(repo, worktreePath, 5000);
    expect(removed).toBe(true);

    // Source-level guard: the canonical safety property is encoded in
    // the file itself — a plain `rm` is never invoked as a subprocess
    // command, anywhere. The doc-comments DO mention "rm -rf" (to
    // document what is forbidden), so we can't just substring-match
    // the file; instead we scan for any `'rm',` element inside a
    // `cmd:` array, which is the only way a shell rm could leak in.
    const source = await readFile(
      join(import.meta.dir, 'worktree.ts'),
      'utf-8'
    );
    const hasShellRm = /['"`]rm['"`]\s*,/.test(source);
    expect(hasShellRm).toBe(false);
    // Also explicitly assert the safe primitives are present so a
    // future refactor that drops them fails loudly.
    expect(source).toContain("'worktree', 'remove'");
    expect(source).toContain("'mv'");
  });

  it('honors the preferredBranch constructor override', async () => {
    const repo = await createTempGitRepo();
    const runner = new WorktreeRunner(repo, 'custom-branch');

    const result = await runner.run(
      state({ goal: 'Should Be Ignored', attempt: 99 })
    );

    const meta = result.metadata as { branch: string; worktreePath: string };
    // Override wins over the goal/attempt slug derivation.
    expect(meta.branch).toBe('custom-branch');
    // Worktree path follows the branch name, so it must reflect the
    // override too.
    expect(meta.worktreePath.endsWith('/custom-branch')).toBe(true);
  });

  it('agent-not-found fallback returns git placeholder output', async () => {
    const repo = await createTempGitRepo();
    const runner = new WorktreeRunner(repo);

    const result = await runner.run(
      state({ goal: 'Agent Not Found Test', attempt: 1 })
    );

    // When no agent binary (opencode/codex) is found, runSubprocess
    // falls back to git placeholder output which contains these markers.
    expect(result.output).toContain('(clean)');
    expect(result.output).toContain('commit:');
    expect(result.output).toContain('branch:');
  });
});
