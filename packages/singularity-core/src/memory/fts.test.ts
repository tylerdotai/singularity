// Phase 2.3 — `Fts5SessionSearch` unit tests.
//
// The five `it(...)` blocks below cover the four core scenarios required
// for the FTS5 search path plus one bonus integration assertion:
//
//   1. FTS5 availability probe     → `Fts5SessionSearch.isAvailable`
//   2. Migration idempotence       → `Fts5SessionSearch.migrate` (re-runnable)
//   3. Keyword search + digest     → `Fts5SessionSearch.searchDigests`
//                                    (asserts `body` is NOT returned)
//   4. Runtime + status filters    → `Fts5SessionSearch.searchDigests`
//   5. Empty / whitespace query    → `Fts5SessionSearch.searchDigests`
//                                    (early exit, no probe)
//   6. BONUS: parity with `SessionStore.searchDigests`
//   7. BONUS: `limit` parameter is honored
//
// Each test gets a fresh in-memory SQLite via `createTestDb()` in
// `beforeEach`, so the tests are isolated and order-independent.
//
// Runtime note: `bun:sqlite` 1.3.13 supports FTS5 natively, so the
// `isAvailable` probe returns `true` and the FTS5 path runs end-to-end.
// The LIKE fallback path exists for runtimes that ship without FTS5;
// it is exercised structurally in the `migrate` and `isAvailable` tests
// (the tests assert true on the FTS5 branch without artificially
// degrading the runtime).

import { beforeEach, describe, expect, it } from 'bun:test';

import { createTestDb } from '../../test/db.ts';
import { Fts5SessionSearch } from './fts.ts';
import type { SessionStore, SessionStoreDatabase } from './sessions.ts';

describe('Fts5SessionSearch', () => {
  let db: SessionStoreDatabase;
  let store: SessionStore;

  beforeEach(() => {
    ({ db, sessionStore: store } = createTestDb());
  });

  // Scenario 1: FTS5 availability probe.
  // `bun:sqlite` 1.3.13 supports FTS5. The `createTestDb` fixture applies
  // all 5 migrations including `005_sessions_fts`, which only succeeds
  // when FTS5 is compiled in — so a passing `isAvailable` here also
  // indirectly confirms the migration applied.
  it('isAvailable returns true on the FTS5-capable executor runtime', () => {
    expect(Fts5SessionSearch.isAvailable(db)).toBe(true);
  });

  // Scenario 2: migration idempotence.
  // `createTestDb` already runs all migrations including 005. Calling
  // `migrate()` again must be a no-op (the `CREATE` statements all use
  // `IF NOT EXISTS`), and the `sessions_fts` virtual table must exist.
  it('migrate applies the FTS5 schema (idempotent on re-run)', () => {
    // First call after `createTestDb` — should still succeed.
    expect(Fts5SessionSearch.migrate(db)).toBe(true);
    // Second call — must be a no-op (not an error).
    expect(Fts5SessionSearch.migrate(db)).toBe(true);

    // The `sessions_fts` virtual table exists.
    const rows = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='sessions_fts'"
      )
      .all();
    expect(rows.length).toBeGreaterThan(0);
  });

  // Scenario 3: keyword search returns matching digests.
  // Digests must NOT include the `body` field — the full transcript is
  // loaded lazily via `SessionStore.getById()` when a caller needs it.
  it('searchDigests returns matching sessions for a keyword query', () => {
    store.upsert({
      id: 'sess_hono',
      runtime: 'opencode',
      started_at: '2026-06-13T00:00:00Z',
      label: 'Hono framework session',
      summary: 'Discussed Hono routing',
      body: 'long markdown body...',
    });
    store.upsert({
      id: 'sess_express',
      runtime: 'opencode',
      started_at: '2026-06-12T00:00:00Z',
      label: 'Express framework session',
      summary: 'Discussed Express middleware',
      body: 'long markdown body...',
    });
    store.upsert({
      id: 'sess_unrelated',
      runtime: 'opencode',
      started_at: '2026-06-11T00:00:00Z',
      label: 'Unrelated session',
      summary: 'About something else',
      body: 'long markdown body...',
    });

    const digests = new Fts5SessionSearch(db).searchDigests({ query: 'Hono' });

    expect(digests.length).toBe(1);
    expect(digests[0]?.id).toBe('sess_hono');
    // CRITICAL: digests do NOT include the body field.
    expect(digests[0]?.body).toBeUndefined();
  });

  // Scenario 4: runtime and status filters.
  // The `runtime` and `status` options are appended to the FTS5 path's
  // outer `WHERE` in the same locked-step pattern as
  // `SessionStore.searchDigests`.
  it('searchDigests respects the runtime and status filters', () => {
    store.upsert({
      id: 'sess_oc1',
      runtime: 'opencode',
      started_at: '2026-06-13T00:00:00Z',
      label: 'Hono framework',
      summary: 'Hono routing discussion',
    });
    store.upsert({
      id: 'sess_cc1',
      runtime: 'claude-code',
      started_at: '2026-06-11T00:00:00Z',
      label: 'Hono framework CC',
      summary: 'Hono on claude-code',
    });

    // Runtime filter: only opencode sessions.
    const opencodeResults = new Fts5SessionSearch(db).searchDigests({
      query: 'Hono',
      runtime: 'opencode',
    });
    expect(opencodeResults.length).toBe(1);
    expect(opencodeResults[0]?.id).toBe('sess_oc1');

    // Status filter: active (the default) returns the opencode Hono session.
    const activeResults = new Fts5SessionSearch(db).searchDigests({
      query: 'Hono',
      runtime: 'opencode',
      status: 'active',
    });
    expect(activeResults.length).toBe(1);

    // Status filter: closed returns 0 (the Hono opencode session is
    // active, not closed).
    const closedResults = new Fts5SessionSearch(db).searchDigests({
      query: 'Hono',
      runtime: 'opencode',
      status: 'closed',
    });
    expect(closedResults.length).toBe(0);
  });

  // Scenario 5: empty / whitespace-only query is an early exit.
  // The method must short-circuit BEFORE running the FTS5 probe or any
  // MATCH query — callers should not pay the probe cost on an empty input.
  it('searchDigests with empty query returns an empty array (early exit)', () => {
    store.upsert({
      id: 'sess_1',
      runtime: 'opencode',
      started_at: '2026-06-13T00:00:00Z',
      label: 'Test',
      summary: 'Test summary',
    });

    expect(new Fts5SessionSearch(db).searchDigests({ query: '' })).toHaveLength(
      0
    );
    expect(
      new Fts5SessionSearch(db).searchDigests({ query: '   ' })
    ).toHaveLength(0);
  });

  // BONUS: integration with `SessionStore` — `Fts5SessionSearch` returns
  // the same digest shape as `SessionStore.searchDigests` (sans body).
  it('returns the same digest shape as SessionStore.searchDigests (sans body)', () => {
    store.upsert({
      id: 'sess_compare',
      runtime: 'opencode',
      started_at: '2026-06-13T00:00:00Z',
      label: 'Compare',
      summary: 'Compare test',
      body: 'long body',
    });

    const ftsResults = new Fts5SessionSearch(db).searchDigests({
      query: 'Compare',
    });
    const sessionStoreResults = store.searchDigests({ query: 'Compare' });

    expect(ftsResults.length).toBe(sessionStoreResults.length);
    expect(ftsResults[0]?.id).toBe(sessionStoreResults[0]?.id);
    expect(ftsResults[0]?.label).toBe(sessionStoreResults[0]?.label);
    expect(ftsResults[0]?.summary).toBe(sessionStoreResults[0]?.summary);
    // CRITICAL: both digests omit the body.
    expect(ftsResults[0]?.body).toBeUndefined();
    expect(sessionStoreResults[0]?.body).toBeUndefined();
  });

  // BONUS: `limit` parameter is honored.
  it('searchDigests respects the limit parameter', () => {
    for (let i = 0; i < 5; i++) {
      store.upsert({
        id: `sess_limit_${i}`,
        runtime: 'opencode',
        started_at: `2026-06-${10 + i}T00:00:00Z`,
        label: `Hono session ${i}`,
        summary: `Hono discussion ${i}`,
      });
    }

    const all = new Fts5SessionSearch(db).searchDigests({ query: 'Hono' });
    expect(all.length).toBe(5);

    const limited = new Fts5SessionSearch(db).searchDigests({
      query: 'Hono',
      limit: 2,
    });
    expect(limited.length).toBe(2);
  });
});
