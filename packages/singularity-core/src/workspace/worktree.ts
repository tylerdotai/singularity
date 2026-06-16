// Phase 5.1 — `WorktreeRunner`. Canonical `Worker` for the closed-loop
// engine. Spawns a subprocess in an isolated git worktree and returns
// an `ActionResult`. Cleanup is 3-tier (git worktree remove → --force →
// mv to ~/.singularity/worktrees/trash); never `rm -rf`. The subprocess
// is a placeholder for Phase 5.1 — Phase 5.2 wires real agent dispatch
// (OpenCode, Codex) into `runSubprocess()`.

import { access, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';

import type { ActionResult, LoopState, Worker } from 'singularity-loop';

/** Discriminator for `WorktreeError.kind`. */
export type WorktreeErrorKind =
  | 'not_a_git_repo'
  | 'worktree_create_failed'
  | 'worktree_remove_failed'
  | 'worktree_list_failed';

/**
 * Thrown when a `git worktree` operation fails. Does NOT represent
 * worker subprocess failures — those propagate as rejected promises
 * from `Worker.run()`.
 */
export class WorktreeError extends Error {
  readonly kind: WorktreeErrorKind;
  readonly worktreePath?: string;

  constructor(kind: WorktreeErrorKind, message: string, worktreePath?: string) {
    super(message);
    this.name = 'WorktreeError';
    this.kind = kind;
    this.worktreePath = worktreePath;
  }
}

/**
 * Canonical `Worker` for code tasks. `run(state)` creates a worktree
 * at `<basePath>/.worktrees/<branch>`, runs the (placeholder) subprocess,
 * captures changed files via `git diff --name-only HEAD`, and returns
 * an `ActionResult` with `metadata.{artifacts,worktreePath,branch,
 * baseCommit,wallClockMs}`. Cleanup runs in the background (3-tier,
 * never `rm -rf`).
 *
 * `Worker` conformance is via `readonly run: Worker` (the design's
 * `Worker['run']` shorthand is invalid — `Worker` is a function type,
 * not an object).
 */
export class WorktreeRunner {
  private readonly basePath: string;
  private readonly preferredBranch: string | undefined;

  /**
   * @param basePath Absolute path to the git repo or any subdirectory
   *   inside it (`git -C basePath` is used for all worktree ops).
   * @param preferredBranch Optional branch override. Defaults to
   *   `${slug(state.goal)}-iter-${state.attempt}`.
   */
  constructor(basePath: string, preferredBranch?: string) {
    this.basePath = basePath;
    this.preferredBranch = preferredBranch;
  }

  /** Run one loop iteration. The engine calls this each attempt. */
  readonly run: Worker = async (state: LoopState): Promise<ActionResult> => {
    const start = Date.now();

    await this.assertGitRepo();

    const branch = this.branchNameFor(state);
    const worktreePath = join(this.basePath, '.worktrees', branch);
    await mkdir(join(this.basePath, '.worktrees'), { recursive: true });

    await this.createWorktree(worktreePath, branch);

    const output = await this.runSubprocess(worktreePath, state.goal);
    const artifacts = await this.captureArtifacts(worktreePath);
    const baseCommit = await this.readHeadCommit(worktreePath);
    const wallClockMs = Date.now() - start;

    const result: ActionResult = {
      output,
      metadata: { artifacts, worktreePath, branch, baseCommit, wallClockMs },
    };

    // Fire-and-forget: cleanup errors are swallowed inside
    // `cleanupWorktree` and must not re-enter the engine's error
    // path after the result has been delivered.
    void this.cleanupWorktree(worktreePath);

    return result;
  };

  private branchNameFor(state: LoopState): string {
    if (this.preferredBranch !== undefined) {
      return this.preferredBranch;
    }
    return `${slugifyGoal(state.goal)}-iter-${state.attempt}`;
  }

  private async assertGitRepo(): Promise<void> {
    const proc = Bun.spawn({
      cmd: ['git', '-C', this.basePath, 'rev-parse', '--is-inside-work-tree'],
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    if (exitCode !== 0 || stdout.trim() !== 'true') {
      throw new WorktreeError(
        'not_a_git_repo',
        `${this.basePath} is not inside a git working tree (exit=${exitCode}, stderr=${stderr.trim() || '<empty>'})`
      );
    }
  }

  /**
   * Create a new git worktree at `worktreePath` with `branch` checked
   * out. The branch is created from `HEAD` (the current commit of
   * `basePath`); `--force` lets us re-run on the same basePath without
   * `git worktree add` complaining about a pre-existing `.worktrees/`
   * entry from a previous attempt.
   *
   * Note: `-b <branch>` is the correct form for creating a new branch
   * from a commit-ish — passing `<branch>` as a positional `<commit-ish>`
   * arg only works if the branch already exists, and the `--no-checkout`
   * flag (a misspelling of git's actual `--no-checkout`) is rejected by
   * modern git. We want the worktree populated (the placeholder
   * subprocess runs `git log` / `git status`), so we let git do the
   * default checkout.
   */
  private async createWorktree(
    worktreePath: string,
    branch: string
  ): Promise<void> {
    const proc = Bun.spawn({
      cmd: [
        'git',
        '-C',
        this.basePath,
        'worktree',
        'add',
        '--force',
        '-b',
        branch,
        worktreePath,
        'HEAD',
      ],
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [stderr, exitCode] = await Promise.all([
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    if (exitCode !== 0) {
      throw new WorktreeError(
        'worktree_create_failed',
        `git worktree add failed (exit=${exitCode}, stderr=${stderr.trim() || '<empty>'})`,
        worktreePath
      );
    }
  }

  /**
   * Detect available agent binary: try `opencode` first, then `codex`,
   * return `null` if neither is found.
   */
  private async detectAgentBinary(): Promise<string | null> {
    for (const bin of ['opencode', 'codex']) {
      try {
        const proc = Bun.spawn({
          cmd: ['which', bin],
          stdout: 'pipe',
          stderr: 'pipe',
        });
        const [stdout, exitCode] = await Promise.all([
          new Response(proc.stdout).text(),
          proc.exited,
        ]);
        if (exitCode === 0 && stdout.trim().length > 0) {
          return bin;
        }
      } catch {
        // continue to next binary
      }
    }
    return null;
  }

  private async runSubprocess(
    worktreePath: string,
    goal: string
  ): Promise<string> {
    const agentBin = await this.detectAgentBinary();

    if (agentBin !== null) {
      const agentCmd = agentBin === 'codex' ? 'exec' : 'run';
      const goalArg = '--goal';
      const proc = Bun.spawn({
        cmd: [agentBin, agentCmd, goalArg, goal],
        cwd: worktreePath,
        stdout: 'pipe',
        stderr: 'pipe',
      });

      const timeoutMs = 2000;
      const timeoutPromise = new Promise<boolean>((resolve) => {
        setTimeout(() => {
          try {
            proc.kill();
          } catch {
            // process may have already exited
          }
          resolve(true);
        }, timeoutMs);
      });

      const exitPromise = proc.exited;
      const [stdout, stderr, exitCode, timedOut] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        exitPromise,
        timeoutPromise,
      ]);

      if (!timedOut && exitCode === 0 && stdout.trim().length > 0) {
        return stdout.trim();
      }

      if (timedOut) {
        process.stderr.write(
          `[worktree-runner] ${agentBin} ${agentCmd} timed out after ${timeoutMs}ms, falling back to git-placeholder\n`
        );
      } else {
        process.stderr.write(
          `[worktree-runner] ${agentBin} ${agentCmd} exited ${exitCode}: ${stderr.trim() || '<empty>'}\n`
        );
      }
    }

    const results = await Promise.allSettled([
      this.gitStatus(worktreePath),
      this.gitLog(worktreePath),
      this.gitDiff(worktreePath),
      this.gitBranches(worktreePath),
    ]);
    const parts: string[] = [];
    for (const r of results) {
      if (r.status === 'fulfilled') parts.push(r.value);
    }
    return parts.join('\n');
  }

  private async gitStatus(worktreePath: string): Promise<string> {
    const proc = Bun.spawn({
      cmd: ['git', '-C', worktreePath, 'status', '--short'],
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    if (exitCode !== 0) {
      return `[git status error: ${stderr.trim() || 'unknown'}]`;
    }
    return stdout.trim().length > 0 ? stdout.trim() : '(clean)';
  }

  private async gitLog(worktreePath: string): Promise<string> {
    const proc = Bun.spawn({
      cmd: ['git', '-C', worktreePath, 'log', '-1', '--format=%s%nH'],
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [stdout, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      proc.exited,
    ]);
    if (exitCode !== 0) return '(no commits)';
    const lines = stdout.trim().split('\n');
    return `commit: ${lines[1] ?? 'unknown'} | ${lines[0] ?? ''}`;
  }

  private async gitDiff(worktreePath: string): Promise<string> {
    const proc = Bun.spawn({
      cmd: ['git', '-C', worktreePath, 'diff', '--stat'],
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [stdout, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      proc.exited,
    ]);
    if (exitCode !== 0) return '';
    return stdout.trim();
  }

  private async gitBranches(worktreePath: string): Promise<string> {
    const proc = Bun.spawn({
      cmd: ['git', '-C', worktreePath, 'branch', '-a'],
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [stdout, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      proc.exited,
    ]);
    if (exitCode !== 0) return '';
    const current = stdout.split('\n').find((l: string) => l.startsWith('*'));
    return `branch: ${current?.trim() ?? 'unknown'}`;
  }

  private async captureArtifacts(
    worktreePath: string
  ): Promise<readonly string[]> {
    const proc = Bun.spawn({
      cmd: ['git', '-C', worktreePath, 'diff', '--name-only', 'HEAD'],
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [stdout, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      proc.exited,
    ]);
    if (exitCode !== 0) {
      return [];
    }
    return stdout
      .split('\n')
      .map((line: string) => line.trim())
      .filter((line: string) => line.length > 0);
  }

  private async readHeadCommit(worktreePath: string): Promise<string> {
    const proc = Bun.spawn({
      cmd: ['git', '-C', worktreePath, 'rev-parse', 'HEAD'],
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [stdout, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      proc.exited,
    ]);
    return exitCode === 0 ? stdout.trim() : '';
  }

  /**
   * Best-effort cleanup. Three tiers: `git worktree remove` →
   * `git worktree remove --force` → `mv` to a trash dir under
   * `~/.singularity/worktrees/trash/`. `rm -rf` is NEVER used.
   * Errors are logged to `stderr` and swallowed; a failed cleanup
   * must not surface as a worker error after the `ActionResult`
   * has been delivered.
   */
  private async cleanupWorktree(worktreePath: string): Promise<void> {
    try {
      const tier1 = Bun.spawn({
        cmd: ['git', '-C', this.basePath, 'worktree', 'remove', worktreePath],
        stdout: 'pipe',
        stderr: 'pipe',
      });
      if ((await tier1.exited) === 0) return;

      const tier2 = Bun.spawn({
        cmd: [
          'git',
          '-C',
          this.basePath,
          'worktree',
          'remove',
          '--force',
          worktreePath,
        ],
        stdout: 'pipe',
        stderr: 'pipe',
      });
      if ((await tier2.exited) === 0) return;

      // Tier 3 (`mv`) will fail with "cannot stat" if the path is
      // already absent — e.g. a concurrent process removed the
      // temp git dir between tier 1 and tier 2. Treat the absent
      // state as a successful no-op so the engine's stderr stays
      // clean. Rejection is the ENOENT case we want to swallow.
      try {
        await access(worktreePath);
      } catch {
        return;
      }

      const trashDir = join(homedir(), '.singularity', 'worktrees', 'trash');
      await mkdir(trashDir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const dest = join(trashDir, `${basename(worktreePath)}-${stamp}`);
      const mv = Bun.spawn({
        cmd: ['mv', worktreePath, dest],
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const mvExit = await mv.exited;
      if (mvExit !== 0) {
        const mvStderr = await new Response(mv.stderr).text();
        process.stderr.write(
          `[worktree-runner] cleanup tier 3 failed (exit=${mvExit}): ${mvStderr.trim() || '<empty>'}\n`
        );
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(
        `[worktree-runner] cleanup threw for ${worktreePath}: ${message}\n`
      );
    }
  }
}

/** Lowercase ASCII slug: `[^a-z0-9]+` → `-`, trim, cap 50 chars. */
function slugifyGoal(goal: string): string {
  return goal
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}
