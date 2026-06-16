// WorktreePanel — Phase 7.2 wired panel.
//
// Read-only view of active git worktrees. The Phase 5.1
// `WorktreeRunner` is a one-shot `Worker` (its `run(state)` creates a
// worktree, runs a subprocess, captures artifacts, cleans up). It
// does NOT keep a registry of "active" worktrees between calls — the
// `worktree_list_failed` error kind is forward-declared in
// `WorktreeErrorKind` for a future phase that needs to enumerate
// worktrees.
//
// The panel therefore enumerates worktrees via `git worktree list`
// against the process's current working directory. The output of
// `git worktree list --porcelain` is one stanza per worktree
// (path + HEAD + branch, separated by blank lines). If the
// invocation fails — e.g. the cwd is not a git working tree — the
// panel surfaces the error and the configured cleanup trash path so
// the user still sees something useful.

import { access } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { For, type JSX, Show } from 'solid-js/dist/solid.js';

interface WorktreeEntry {
  readonly path: string;
  readonly head: string;
  readonly branch: string;
}

export interface WorktreeData {
  readonly entries: readonly WorktreeEntry[];
  readonly cwd: string;
  readonly trashDir: string;
}

export interface WorktreePanelProps {
  readonly data?: WorktreeData;
  readonly error?: string;
}

export async function loadWorktrees(): Promise<WorktreeData> {
  const cwd = process.cwd();
  const trashDir = join(homedir(), '.singularity', 'worktrees', 'trash');
  const proc = Bun.spawn({
    cmd: ['git', '-C', cwd, 'worktree', 'list', '--porcelain'],
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (exitCode !== 0) {
    throw new Error(
      `git worktree list failed (exit=${exitCode}): ${stderr.trim() || '<empty>'}`
    );
  }

  const entries: WorktreeEntry[] = [];
  let current: { path?: string; head?: string; branch?: string } = {};
  for (const line of stdout.split('\n')) {
    if (line.length === 0) {
      if (current.path !== undefined) {
        entries.push({
          path: current.path,
          head: current.head ?? '',
          branch: current.branch ?? '',
        });
      }
      current = {};
      continue;
    }
    const [key, ...rest] = line.split(' ');
    const value = rest.join(' ');
    if (key === 'worktree') current.path = value;
    else if (key === 'HEAD') current.head = value;
    else if (key === 'branch') current.branch = value;
  }
  if (current.path !== undefined) {
    entries.push({
      path: current.path,
      head: current.head ?? '',
      branch: current.branch ?? '',
    });
  }

  // Touch the trash dir so the panel can report whether it exists;
  // a missing trash dir is normal (no worktree has been cleaned up
  // yet) and is not an error.
  let trashExists = true;
  try {
    await access(trashDir);
  } catch {
    trashExists = false;
  }

  return {
    entries,
    cwd,
    trashDir: `${trashDir}${trashExists ? '' : ' (not yet created)'}`,
  };
}

function shortHash(head: string): string {
  return head.length > 7 ? head.slice(0, 7) : head;
}

export function WorktreePanel(props: WorktreePanelProps): JSX.Element {
  return (
    <box flexDirection="column" padding={1}>
      <text>
        <strong>Worktree</strong>
      </text>
      <text> </text>

      <Show when={props.data === undefined && props.error === undefined}>
        <text>
          <span style={{ fg: '#888888' }}>loading worktree list...</span>
        </text>
      </Show>

      <Show when={props.error !== undefined}>
        <text>
          <span style={{ fg: '#cc4444' }}>Error: {props.error}</span>
        </text>
      </Show>

      <Show when={props.data}>
        {(loaded: () => WorktreeData) => (
          <>
            <text>
              <span style={{ fg: '#888888' }}>cwd: {loaded().cwd}</span>
            </text>
            <text>
              <span style={{ fg: '#888888' }}>trash: {loaded().trashDir}</span>
            </text>
            <text> </text>
            <Show
              when={loaded().entries.length > 0}
              fallback={
                <text>
                  <span style={{ fg: '#888888' }}>
                    No git worktrees registered for the current directory.
                  </span>
                </text>
              }
            >
              <text>
                <span style={{ fg: '#aaaaaa' }}>
                  Active worktrees ({loaded().entries.length}):
                </span>
              </text>
              <For each={loaded().entries}>
                {(entry: WorktreeEntry) => (
                  <box flexDirection="row">
                    <text>
                      [{shortHash(entry.head)}] {entry.branch || '<detached>'}{' '}
                      <span style={{ fg: '#888888' }}>{entry.path}</span>
                    </text>
                  </box>
                )}
              </For>
            </Show>
          </>
        )}
      </Show>
    </box>
  );
}
