// MemoryPanel — Phase 7.2 wired panel.
//
// Read-only view of the active profile's memory subsystem. The
// panel surfaces two derived metrics and a list of recent sessions:
//
//   1. Session count from `SessionStore.searchDigests({ limit: 10 })`.
//   2. Fact count from `FactStore.recall(undefined, undefined, ...)`.
//   3. The 10 most recent session digests (label, runtime, status,
//      started_at).
//
// Data lifecycle:
//   - `ProfileResolver.resolveDefault()` returns the per-profile
//     `state.db` path. As in the approvals panel, this may
//     bootstrap the default profile on first use; the resolver
//     contract handles that.
//   - The panel applies every entry in the memory `MIGRATIONS`
//     barrel (idempotent `IF NOT EXISTS` statements) so a freshly
//     bootstrapped DB has the `facts` and `sessions` tables before
//     the stores query them. No new migrations here — the array is
//     imported from the existing memory subsystem.
//   - Migration 004 is NOT actually idempotent in practice: its
//     `ALTER TABLE facts RENAME TO facts_old` pattern fails with
//     "error in view fact_history: no such table: main.facts_old"
//     when re-run against a DB that already has the post-migration
//     schema (SQLite refuses to rename a table that has a
//     dependent view). The panel detects the post-migration state
//     via `isMemorySchemaPresent` and skips the migrations
//     entirely when the schema is already in place.
//   - Both stores are constructed against the same DB connection
//     and the DB is closed in a `finally` block so the file handle
//     is released even if either store throws.

import { Database } from 'bun:sqlite';
import {
  FactStore,
  ProfileResolver,
  type Session,
  SessionStore,
} from 'singularity-core';
import { For, type JSX, Show } from 'solid-js/dist/solid.js';
import { MIGRATIONS } from '../../../../singularity-core/src/memory/migrations/index.ts';

export interface MemoryData {
  readonly sessions: readonly Session[];
  readonly factCount: number;
  readonly sessionCount: number;
}

export interface MemoryPanelProps {
  readonly data?: MemoryData;
  readonly error?: string;
}

// Object names produced by memory migrations 001-005. Used by
// `isMemorySchemaPresent` to short-circuit the migration loop on a
// re-run. `fact_history` is a view (not a table); the query below
// uses `type IN ('table', 'view')` so the check covers both.
const POST_MIGRATION_OBJECTS: readonly string[] = [
  'facts',
  'sessions',
  'session_edges',
  'sessions_fts',
  'fact_history',
];

/**
 * Detect whether the memory schema is already in the
 * post-migration state. The check is intentionally based on
 * `sqlite_master` (the source of truth for object existence) rather
 * than the migration barrel version, because the panel does not own
 * the `schema_migrations` table — the production migration runner
 * does, and it does not run on the panel's read path.
 */
function isMemorySchemaPresent(db: Database): boolean {
  const rows = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type IN ('table', 'view') AND name = ?"
    )
    .all(POST_MIGRATION_OBJECTS[0]) as Array<{ name: string }>;
  const present = new Set<string>(rows.map((r) => r.name));
  // `prepare(...).all(arg)` only accepts a single bound parameter;
  // query the rest in a loop. Five cheap point lookups is
  // preferable to building a dynamic IN-list just to avoid it.
  for (let i = 1; i < POST_MIGRATION_OBJECTS.length; i++) {
    const more = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type IN ('table', 'view') AND name = ?"
      )
      .all(POST_MIGRATION_OBJECTS[i]) as Array<{ name: string }>;
    for (const row of more) present.add(row.name);
  }
  return POST_MIGRATION_OBJECTS.every((name) => present.has(name));
}

export async function loadMemory(): Promise<MemoryData> {
  const resolver = new ProfileResolver();
  const resolved = await resolver.resolveDefault();
  const db = new Database(resolved.stateDbPath);
  try {
    if (!isMemorySchemaPresent(db)) {
      for (const migration of MIGRATIONS) {
        db.exec(migration.sql);
      }
    }
    const sessionStore = new SessionStore(db);
    const factStore = new FactStore(db);
    const sessions = sessionStore.searchDigests({ limit: 10 });
    const facts = factStore.recall(undefined, undefined, { limit: 1_000 });
    // `searchDigests` is ordered newest-first by `started_at DESC`,
    // so the leading 10 entries are the most recent.
    return {
      sessions,
      factCount: facts.length,
      sessionCount: sessions.length,
    };
  } finally {
    db.close();
  }
}

function formatTimestamp(value: string): string {
  return value.replace('T', ' ').slice(0, 19);
}

export function MemoryPanel(props: MemoryPanelProps): JSX.Element {
  return (
    <box flexDirection="column" padding={1}>
      <text>
        <strong>Memory</strong>
      </text>
      <text> </text>

      <Show when={props.data === undefined && props.error === undefined}>
        <text>
          <span style={{ fg: '#888888' }}>loading...</span>
        </text>
      </Show>

      <Show when={props.error !== undefined}>
        <text>
          <span style={{ fg: '#cc4444' }}>Error: {props.error}</span>
        </text>
      </Show>

      <Show when={props.data}>
        {(loaded: () => MemoryData) => (
          <>
            <text>Sessions: {loaded().sessionCount}</text>
            <text>Facts: {loaded().factCount}</text>
            <text> </text>
            <Show
              when={loaded().sessions.length > 0}
              fallback={
                <text>
                  <span style={{ fg: '#888888' }}>
                    No sessions recorded for the active profile yet. The Phase
                    7.1 CLI does not yet emit sessions; this list will populate
                    once the chat / gateway surfaces land.
                  </span>
                </text>
              }
            >
              <text>
                <span style={{ fg: '#aaaaaa' }}>Recent sessions:</span>
              </text>
              <For each={loaded().sessions}>
                {(session: Session) => (
                  <box flexDirection="row">
                    <text>
                      [{session.status}] {session.label}{' '}
                      <span style={{ fg: '#888888' }}>
                        ({session.runtime} ·{' '}
                        {formatTimestamp(session.started_at)})
                      </span>
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
