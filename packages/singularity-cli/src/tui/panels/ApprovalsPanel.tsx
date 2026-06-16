// ApprovalsPanel — Phase 7.2 wired panel.
//
// Read-only view of approval grants stored in the active profile's
// `approvals` table via the `SqliteGrantVault` from `singularity-approvals`.
// The panel surfaces three pieces of data on mount:
//
//   1. Total grant count (`vault.list()`).
//   2. Effect breakdown (allow vs deny) computed locally from the list.
//   3. The 10 most recent grants (sorted newest-first by `grantedAt`).
//
// Data lifecycle:
//   - `ProfileResolver.resolveDefault()` is called on mount to get the
//     per-profile `state.db` path. This will bootstrap the default
//     profile on first use (mkdir + open + migrate + insert default
//     row) — the existing resolver contract, no new schema work here.
//   - The panel opens the DB, applies the `approvals` table schema
//     (idempotent `CREATE TABLE IF NOT EXISTS` from
//     `singularity-core/src/approvals/schema.sql.ts`), constructs the
//     vault, reads the grants, then closes the DB in a `finally` block
//     so the file handle is released even on error.
//   - All reads are read-only; no write paths in the vault or panel.
//
// States:
//   - `loading`: resource is in-flight. Show a single-line loader.
//   - `errored`: the resource threw. Surface the message verbatim;
//     the user already knows how to read errors.
//   - `empty`:   the vault returned zero grants. Show a hint that
//     the user has not approved / denied anything yet.
//   - `loaded`:  render the summary block + the recent-grants list.

import { Database } from 'bun:sqlite';
import { type Grant, SqliteGrantVault } from 'singularity-approvals';
import { ProfileResolver } from 'singularity-core';
import { For, type JSX, Show } from 'solid-js/dist/solid.js';
import { APPROVALS_TABLE_SQL } from '../../../../singularity-core/src/approvals/schema.sql.ts';

export interface ApprovalData {
  readonly grants: readonly Grant[];
}

export interface ApprovalsPanelProps {
  readonly data?: ApprovalData;
  readonly error?: string;
}

export async function loadApprovals(): Promise<ApprovalData> {
  const resolver = new ProfileResolver();
  const resolved = await resolver.resolveDefault();
  const db = new Database(resolved.stateDbPath);
  try {
    db.exec(APPROVALS_TABLE_SQL);
    const vault = new SqliteGrantVault(db);
    const grants = await vault.list();
    // Newest first — vault.list() preserves insertion order, so we
    // re-sort on `grantedAt` descending. The vault is the
    // authoritative read source; this is purely a display concern.
    const sorted = [...grants].sort(
      (a, b) => b.grantedAt.getTime() - a.grantedAt.getTime()
    );
    return { grants: sorted };
  } finally {
    db.close();
  }
}

function formatTimestamp(date: Date): string {
  return date.toISOString().replace('T', ' ').slice(0, 19);
}

function summarize(grants: readonly Grant[]): {
  readonly total: number;
  readonly allow: number;
  readonly deny: number;
} {
  let allow = 0;
  let deny = 0;
  for (const g of grants) {
    if (g.effect === 'allow') allow += 1;
    else if (g.effect === 'deny') deny += 1;
  }
  return { total: grants.length, allow, deny };
}

export function ApprovalsPanel(props: ApprovalsPanelProps): JSX.Element {
  return (
    <box flexDirection="column" padding={1}>
      <text>
        <strong>Approvals</strong>
      </text>
      <text> </text>

      <Show when={props.data === undefined && props.error === undefined}>
        <text>
          <span style={{ fg: '#888888' }}>loading grants...</span>
        </text>
      </Show>

      <Show when={props.error !== undefined}>
        <text>
          <span style={{ fg: '#cc4444' }}>Error: {props.error}</span>
        </text>
      </Show>

      <Show when={props.data}>
        {(loaded: () => ApprovalData) => {
          const approvalData = loaded();
          const summary = summarize(approvalData.grants);
          return (
            <>
              <text>
                Total grants: {summary.total} (allow: {summary.allow}, deny:{' '}
                {summary.deny})
              </text>
              <text> </text>
              <Show
                when={approvalData.grants.length > 0}
                fallback={
                  <text>
                    <span style={{ fg: '#888888' }}>
                      No grants stored yet. Approve or deny an action to
                      populate this view.
                    </span>
                  </text>
                }
              >
                <text>
                  <span style={{ fg: '#aaaaaa' }}>Recent (newest first):</span>
                </text>
                <For each={approvalData.grants.slice(0, 10)}>
                  {(grant: Grant) => (
                    <box flexDirection="row">
                      <text>
                        [{grant.effect}] {grant.action}
                        {grant.resource !== undefined
                          ? ` ${grant.resource}`
                          : ''}{' '}
                        <span style={{ fg: '#888888' }}>
                          ({formatTimestamp(grant.grantedAt)})
                        </span>
                      </text>
                    </box>
                  )}
                </For>
              </Show>
            </>
          );
        }}
      </Show>
    </box>
  );
}
