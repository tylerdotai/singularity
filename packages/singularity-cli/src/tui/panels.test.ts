// Phase 7.2 — TUI panel data-loader tests.
//
// Each test exercises the data-loading function behind a panel
// (exported for testability) against a per-test temp HOME so the
// resolver never touches the real `~/.singularity/profiles/default`.
// The panels themselves render JSX, which is not unit-testable in
// this environment (no TTY), so these tests cover the data path;
// the panel render path is covered by the bunfig.toml preload
// (which throws at startup if the @opentui/solid JSX runtime is
// broken) and by the import-time smoke check that runs the
// existing `bun test` suite.
//
// What is NOT tested here:
//   - The TUI render output. OpenTUI requires a TTY, so renderer-
//     level assertions are out of scope for `bun test`.
//   - Interactive behaviour (tab navigation, q/ctrl+c exit). The
//     existing `index.test.ts` covers the dispatcher no-TTY branch.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadApprovals } from './panels/ApprovalsPanel.js';
import { loadMemory } from './panels/MemoryPanel.js';
import { loadSkills } from './panels/SkillsPanel.js';
import { loadSubagents } from './panels/SubagentsPanel.js';
import { loadWorktrees } from './panels/WorktreePanel.js';

let tempHome: string;

beforeEach(() => {
  tempHome = mkdtempSync(join(tmpdir(), 'singularity-panel-test-'));
  // `ProfileResolver` reads `SINGULARITY_HOME ?? homedir()` to find
  // the profile root. We set `SINGULARITY_HOME` to the temp dir so
  // the loaders find a fresh profile DB on every test run, regardless
  // of the host's real `~/.singularity` state. `HOME` is also
  // redirected as a defensive fallback for any code path that uses
  // `homedir()` directly.
  process.env.SINGULARITY_HOME = tempHome;
  process.env.HOME = tempHome;
  process.env.USERPROFILE = tempHome;
});

afterEach(() => {
  process.env.SINGULARITY_HOME = undefined;
  rmSync(tempHome, { recursive: true, force: true });
});

describe('ApprovalsPanel', () => {
  test('loadApprovals returns an empty grants list for a fresh profile', async () => {
    const data = await loadApprovals();
    expect(Array.isArray(data.grants)).toBe(true);
    // A fresh profile has no approvals; the panel will render the
    // "No grants stored yet" empty state.
    expect(data.grants.length).toBe(0);
  });
});

describe('MemoryPanel', () => {
  test('loadMemory returns zero sessions and zero facts for a fresh profile', async () => {
    const data = await loadMemory();
    expect(data.sessions).toEqual([]);
    expect(data.sessionCount).toBe(0);
    expect(data.factCount).toBe(0);
  });
});

describe('SkillsPanel', () => {
  test('loadSkills returns an empty registry by default', async () => {
    const data = await loadSkills();
    expect(data.skills).toEqual([]);
    expect(data.totalCount).toBe(0);
  });
});

describe('SubagentsPanel', () => {
  test('loadSubagents returns a normalized contract and zero active tasks', async () => {
    const data = await loadSubagents();
    // The Phase 6.2 normalizer fills the optional fields with
    // deterministic defaults; the demo contract always has the
    // canonical 7 required fields.
    expect(typeof data.contract.id).toBe('string');
    expect(data.contract.id.startsWith('subtask_')).toBe(true);
    expect(data.contract.goal.length).toBeGreaterThan(0);
    expect(data.contract.context.summary.length).toBeGreaterThan(0);
    expect(data.contract.allowedTools).toBeInstanceOf(Array);
    expect(data.contract.workIsolation.kind).toBe('none');
    expect(data.contract.resultSchema.kind).toBe('text');
    expect(data.contract.maxTurns).toBe(5);
    expect(data.taskCount).toBe(0);
  });
});

describe('WorktreePanel', () => {
  test('loadWorktrees throws with a clear message when cwd is not a git repo', async () => {
    // The default cwd when running `bun test` may already be a git
    // repo (the fork-bootstrap). To force a non-repo state, chdir
    // into the temp HOME created by `beforeEach`.
    const originalCwd = process.cwd();
    try {
      process.chdir(tempHome);
      await expect(loadWorktrees()).rejects.toThrow(/git worktree list failed/);
    } finally {
      process.chdir(originalCwd);
    }
  });

  test('loadWorktrees enumerates worktrees in a git repo', async () => {
    const originalCwd = process.cwd();
    try {
      process.chdir(tempHome);
      // `git init` is cheap; the loader reads `git worktree list`
      // which succeeds for a fresh repo (no worktrees yet).
      const proc = Bun.spawn({
        cmd: ['git', 'init', '--initial-branch=main'],
        cwd: tempHome,
        stdout: 'pipe',
        stderr: 'pipe',
      });
      await proc.exited;

      const data = await loadWorktrees();
      // A fresh repo has exactly one entry (the main worktree).
      // `git worktree list --porcelain` reports the branch as
      // `refs/heads/main` (the fully-qualified ref name), not `main`.
      expect(data.entries.length).toBe(1);
      expect(data.entries[0].branch).toBe('refs/heads/main');
    } finally {
      process.chdir(originalCwd);
    }
  });
});
