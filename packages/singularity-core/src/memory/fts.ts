// Phase 2.3 — `Fts5SessionSearch`: FTS5-backed keyword search for the
// sessions table, with a transparent `LIKE` fallback for runtimes that
// ship without the FTS5 extension.
//
// Design note — why a separate class from `SessionStore`:
//
//   `SessionStore.searchDigests()` (Phase 2.2) uses `LIKE %query%` against
//   `label` and `summary` and ships that as the in-process recall path.
//   Adding FTS5 to that method would force every consumer of `SessionStore`
//   to pay the FTS5 probe cost on construction, and would couple the LIKE
//   path to FTS5 availability. Keeping `Fts5SessionSearch` as a parallel
//   class lets each caller opt in:
//
//     - `SessionStore.searchDigests(options)` — always LIKE, no probe.
//     - `Fts5SessionSearch.searchDigests(options)` — FTS5 with LIKE fallback.
//
//   Future callers (Phase 7 CLI `singularity sessions recall ...`, Phase 8
//   gateways) pick whichever fits the deployment. A runtime with FTS5
//   gets ranked keyword search; a runtime without it transparently
//   degrades to substring match. Neither caller has to know which path
//   ran.
//
// Runtime detection:
//
//   `isAvailable()` probes the FTS5 module at call time by attempting
//   `CREATE VIRTUAL TABLE ... USING fts5(x);` and dropping the probe.
//   The constructor does NOT probe; the first `searchDigests` call (and
//   `migrate()` callers) run the probe lazily. There is no `skipFts5`
//   flag in Phase 2.3 — a future phase adds a runner-level option to
//   short-circuit the probe.
//
// FTS5 path vs LIKE path:
//
//   - FTS5: `sessions_fts MATCH ? ORDER BY rank` with a sub-select
//     returning matching `rowid`s; the outer SELECT joins back to
//     `sessions` to project the digest column set. FTS5 query syntax
//     (`Hono OR Express`, `term*`, ...) is passed verbatim.
//   - LIKE: `(label LIKE ? OR summary LIKE ?)` with `%query%` bound on
//     both sides. Ordered by `started_at DESC` (newest first) since LIKE
//     has no native rank.
//
// Both paths share the same `?`-placeholder discipline: every user value
// is bound, no string interpolation of values. The digest column set is
// the local `SESSION_DIGEST_COLUMNS` constant — the canonical digest
// payload established in `sessions.ts` Phase 2.2, copied here rather
// than imported to keep this module's import surface flat.

import { MIGRATION_005_SQL } from './migrations/005_sessions_fts.sql.js';
import type {
  Session,
  SessionStatus,
  SessionStoreDatabase,
} from './sessions.ts';

// ---------- Types ----------

export interface Fts5SessionSearchOptions {
  query: string;
  runtime?: string;
  status?: SessionStatus;
  limit?: number;
}

// ---------- Local helpers ----------

/**
 * Cast a raw row from a digest-shaped `SELECT` into a `Session`. The digest
 * column set omits `body` (the field is set to `null` on the returned object
 * because the column is absent from the projection), matching the
 * Phase 2.2 `SessionStore.searchDigests` contract.
 *
 * Same trust-the-schema argument as `sessions.ts::rowToSession`.
 */
function rowToSession(row: unknown): Session {
  return row as unknown as Session;
}

// Column list used by digest search. Identical to the constant in
// `sessions.ts`; copied locally to keep this module's import surface
// flat (only `sessions.ts` types are imported — the constant is a
// stable, structurally-fixed string).
const SESSION_DIGEST_COLUMNS =
  'id, runtime, runtime_session_id, started_at, ended_at, duration_min, ' +
  'label, summary, status, transcript_kind, transcript_path, ' +
  'transcript_offset, transcript_length, created_at, updated_at';

// ---------- Implementation ----------

export class Fts5SessionSearch {
  private readonly db: SessionStoreDatabase;

  constructor(db: SessionStoreDatabase) {
    this.db = db;
  }

  /**
   * Probe FTS5 support on the underlying SQLite connection.
   *
   * Tries to create a tiny throwaway FTS5 virtual table; on success the
   * probe is dropped and the method returns `true`. On failure (the
   * FTS5 module is missing, e.g. `no such module: fts5`, or a syntax
   * error in the probe DDL) the error is swallowed and the method
   * returns `false`. Never throws — callers can use the boolean to
   * branch without try/catch noise.
   *
   * The probe is intentionally minimal: a single unnamed column
   * (`x`) is enough to exercise the `USING fts5(...)` clause, which
   * is what fails when the FTS5 module is not compiled in.
   */
  static isAvailable(db: SessionStoreDatabase): boolean {
    try {
      db.exec('CREATE VIRTUAL TABLE IF NOT EXISTS ftsprobe USING fts5(x);');
      db.exec('DROP TABLE ftsprobe;');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Apply migration 005 (FTS5 sessions_fts + 3 triggers).
   *
   * Runs the `MIGRATION_005_SQL` constant via `db.exec` inside a
   * try/catch. Returns `true` on success, `false` on failure. The
   * caller (typically the migration runner or a test fixture)
   * decides whether to apply the migration and how to handle the
   * boolean — this method does not throw and does not log.
   *
   * The migration requires the FTS5 module. Callers that want
   * graceful degradation should probe with `isAvailable()` first
   * and skip the migration when it returns `false`.
   */
  static migrate(db: SessionStoreDatabase): boolean {
    try {
      db.exec(MIGRATION_005_SQL);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Digest search with FTS5 ranking and a transparent LIKE fallback.
   *
   * Returns rows WITHOUT the `body` field — callers load the full
   * transcript lazily via `SessionStore.getById()` when they
   * actually need it.
   *
   * Path selection:
   *   1. Empty / whitespace-only `query` → `[]` (no probe, no query).
   *   2. `Fts5SessionSearch.isAvailable(this.db) === true` → FTS5
   *      path: sub-select over `sessions_fts MATCH ? ORDER BY rank`,
   *      outer join to `sessions` projecting the digest columns.
   *   3. Otherwise → LIKE fallback: `(label LIKE ? OR summary LIKE ?)`
   *      ordered by `started_at DESC` (newest first).
   *
   * The `status` and `runtime` filters, when present, are appended to
   * BOTH paths in the same locked-step pattern as `SessionStore.searchDigests`
   * (one `?` per filter, params array grows in lockstep with the SQL).
   *
   * Default `limit = 10`. The MATCH `?` on the FTS5 path is the user
   * query verbatim (FTS5 syntax allowed by the server — `Hono OR Express`,
   * `term*`, etc.). On the LIKE path the query is wrapped in `%...%`.
   */
  searchDigests(options: Fts5SessionSearchOptions): Session[] {
    const { query, runtime, status } = options;
    const limit = options.limit ?? 10;

    // 1. Early exit on empty / whitespace-only query.
    if (query.trim().length === 0) {
      return [];
    }

    // 2. Path selection.
    if (Fts5SessionSearch.isAvailable(this.db)) {
      return this.searchFts5(query, runtime, status, limit);
    }
    return this.searchLike(query, runtime, status, limit);
  }

  /**
   * FTS5 path: sub-select over `sessions_fts` returning matching
   * `rowid`s ordered by `rank`, outer join to `sessions` projecting
   * the digest columns. Optional `status` / `runtime` filters apply
   * to the outer SELECT. The MATCH `?` is the user query verbatim.
   */
  private searchFts5(
    query: string,
    runtime: string | undefined,
    status: SessionStatus | undefined,
    limit: number
  ): Session[] {
    const where: string[] = [];
    const params: unknown[] = [];

    // The MATCH ? is bound in the sub-select — always present.
    // (The empty-query early exit in `searchDigests` means we
    // never reach here with an empty query.)
    const matchParam = query;

    if (status !== undefined) {
      where.push('status = ?');
      params.push(status);
    }
    if (runtime !== undefined) {
      where.push('runtime = ?');
      params.push(runtime);
    }

    const whereClause = where.length > 0 ? `AND ${where.join(' AND ')}` : '';
    const sql = `SELECT ${SESSION_DIGEST_COLUMNS} FROM sessions WHERE rowid IN (SELECT rowid FROM sessions_fts WHERE sessions_fts MATCH ? ORDER BY rank) ${whereClause} LIMIT ?`;

    params.push(limit);

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(matchParam, ...params);
    return rows.map((row) => rowToSession(row));
  }

  /**
   * LIKE fallback path: `(label LIKE ? OR summary LIKE ?)` with
   * `%query%` bound on both sides, ordered by `started_at DESC`.
   * Optional `status` / `runtime` filters apply in the same locked-
   * step pattern as `SessionStore.searchDigests`.
   */
  private searchLike(
    query: string,
    runtime: string | undefined,
    status: SessionStatus | undefined,
    limit: number
  ): Session[] {
    const where: string[] = [];
    const params: unknown[] = [];

    // LIKE %query% on both label and summary — both ? placeholders
    // share the same bound value.
    where.push('(label LIKE ? OR summary LIKE ?)');
    params.push(`%${query}%`, `%${query}%`);

    if (status !== undefined) {
      where.push('status = ?');
      params.push(status);
    }
    if (runtime !== undefined) {
      where.push('runtime = ?');
      params.push(runtime);
    }

    const whereClause = `WHERE ${where.join(' AND ')}`;
    const sql =
      `SELECT ${SESSION_DIGEST_COLUMNS} FROM sessions ` +
      `${whereClause} ORDER BY started_at DESC LIMIT ?`;

    params.push(limit);

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params);
    return rows.map((row) => rowToSession(row));
  }
}
