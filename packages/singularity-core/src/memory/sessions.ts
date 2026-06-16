// Phase 2.2 — `SessionStore`: SQLite-backed session memory store.
//
// Schema: `packages/singularity-core/src/memory/sessions.sql.ts`
//   The `sessions` and `session_edges` tables mirror nlm-memory's
//   `migrations/000_initial_schema.sql` lines 14-32 and 89-94 (Apache-2.0)
//   verbatim. Column order, CHECK constraints, defaults, and FK actions are
//   kept byte-identical so the same ingest path (a runtime emitting a
//   transcript + a hermes-derived digest) writes cleanly to either backend.
//
// `upsert()` uses `INSERT OR REPLACE` for idempotency: re-ingesting the same
// session id from a transcript is a no-op write (the row is overwritten with
// identical data). This matters for resumable adapters that re-emit the
// opening segment after a crash.
//
// `searchDigests()` returns rows WITHOUT the `body` field. The full
// transcript is loaded lazily via `getById()` when a caller actually needs
// the markdown body — e.g. when replaying a session or quoting it. Keeping
// the digest payload small keeps the recall surface cheap (digest-time
// search reads `summary` + `label` + `transcript_path`, not `body`).
//
// `markSuperseded()` accepts a `reason` string for parity with nlm-memory's
// `markSupersededHandler` (MCP tool description documents the reason as
// "logged to the supersedence audit log for provenance"). Phase 2.2 does
// not yet have a `supersedence_log` table — the value is accepted but
// dropped, with a TODO pointing at a future phase that adds the audit log
// per nlm-memory's `core/storage/supersedence-log.ts`.
//
// Database shim:
//   `SessionStoreDatabase` is the same minimum common surface shared by
//   `bun:sqlite` and `better-sqlite3` as `FactStoreDatabase`. Neither backend
//   is imported here; callers pass whichever the runtime already has open.

// ---------- Types ----------

export type SessionStatus = 'active' | 'closed' | 'superseded';

export type SessionEdgeKind =
  | 'supersedes'
  | 'continues'
  | 'branched_from'
  | 'merged_from';

export interface Session {
  id: string;
  runtime: string;
  runtime_session_id: string | null;
  started_at: string;
  ended_at: string | null;
  duration_min: number | null;
  label: string;
  summary: string;
  body: string | null;
  status: SessionStatus;
  transcript_kind: string | null;
  transcript_path: string | null;
  transcript_offset: number | null;
  transcript_length: number | null;
  created_at: string;
  updated_at: string;
}

export interface SessionEdge {
  from_session: string;
  to_session: string;
  kind: SessionEdgeKind;
  created_at: string;
}

export interface CreateSessionInput {
  id?: string;
  runtime: string;
  runtime_session_id?: string | null;
  started_at: string;
  ended_at?: string | null;
  duration_min?: number | null;
  label: string;
  summary: string;
  body?: string | null;
  status?: SessionStatus;
  transcript_kind?: string | null;
  transcript_path?: string | null;
  transcript_offset?: number | null;
  transcript_length?: number | null;
}

export interface DigestSearchOptions {
  query?: string;
  runtime?: string;
  status?: SessionStatus;
  limit?: number;
}

export interface LineageOptions {
  direction?: 'parents' | 'children' | 'both';
  kinds?: SessionEdgeKind[];
}

export interface MarkSupersededInput {
  predecessorId: string;
  successorId: string;
  reason?: string;
}

// Minimum common surface of `bun:sqlite` and `better-sqlite3`. Identical to
// the `FactStoreDatabase` interface in `facts.ts` — kept structurally
// compatible so a single `db` instance can be passed to both stores.
export interface SessionStoreDatabase {
  prepare(sql: string): {
    run(...params: unknown[]): {
      changes: number;
      lastInsertRowid: number | bigint;
    };
    all(...params: unknown[]): unknown[];
    get(...params: unknown[]): unknown;
  };
  exec(sql: string): void;
}

// ---------- Implementation ----------

/**
 * Cast a raw row from `SELECT * FROM sessions` into a `Session`.
 *
 * The column set of the `sessions` table (see `sessions.sql.ts`) is a
 * superset of the `Session` interface by construction: every field in
 * `Session` is a column and every column is a field. The cast is therefore
 * safe — we trust the schema, not the row.
 */
function rowToSession(row: unknown): Session {
  return row as unknown as Session;
}

/**
 * Cast a raw row from `SELECT * FROM session_edges` into a `SessionEdge`.
 *
 * Same trust-the-schema argument as `rowToSession`. The `created_at` column
 * is filled by the `DEFAULT (datetime('now'))` clause on the table; it is
 * NOT in the column list passed to `INSERT OR IGNORE`, so the round-trip
 * via `getById`-style select is what surfaces it.
 */
function rowToSessionEdge(row: unknown): SessionEdge {
  return row as unknown as SessionEdge;
}

/**
 * Generate a unique id for a session row. Uses `Math.random()`-based hex
 * because the singularity-core tsconfig ships with `lib: ["ES2022"]` only —
 * neither `Web Crypto` (DOM) nor `node:crypto` is in the type surface here.
 * The id is a 32-character hex string prefixed with `sess_`, giving 128 bits
 * of entropy with a readable prefix. Two sessions generated in the same
 * tick can collide only in adversarial conditions; for the in-process test
 * fixture and the single-process SessionStore usage of Phase 2.2, this is
 * more than enough.
 */
function generateId(): string {
  const bytes = new Array<number>(16);
  for (let i = 0; i < 16; i++) {
    bytes[i] = Math.floor(Math.random() * 256);
  }
  return `sess_${bytes.map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

// Column list used by digest search. Explicitly omits `body` so the digest
// payload stays small — the full transcript is loaded lazily via
// `getById()` when a caller actually needs it.
const SESSION_DIGEST_COLUMNS =
  'id, runtime, runtime_session_id, started_at, ended_at, duration_min, ' +
  'label, summary, status, transcript_kind, transcript_path, ' +
  'transcript_offset, transcript_length, created_at, updated_at';

export class SessionStore {
  private readonly db: SessionStoreDatabase;

  constructor(db: SessionStoreDatabase) {
    this.db = db;
  }

  /**
   * Insert or replace a session row. The `INSERT OR REPLACE` form is
   * idempotent for re-ingesting the same session id from a transcript —
   * the row is overwritten with identical data and `changes` reflects the
   * replace. `updated_at` is reset to `datetime('now')` by the column
   * default.
   *
   * Generates the id as `sess_<32 hex chars>` when `input.id` is absent.
   * Defaults `status` to `"active"` when not provided.
   *
   * Returns the row via `getById` so callers always see the canonical
   * `created_at` / `updated_at` values the database actually persisted.
   */
  upsert(input: CreateSessionInput): Session {
    const id = input.id ?? generateId();
    const status: SessionStatus = input.status ?? 'active';

    const stmt = this.db.prepare(
      `INSERT OR REPLACE INTO sessions (
         id, runtime, runtime_session_id, started_at, ended_at, duration_min,
         label, summary, body, status,
         transcript_kind, transcript_path, transcript_offset, transcript_length
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    stmt.run(
      id,
      input.runtime,
      input.runtime_session_id ?? null,
      input.started_at,
      input.ended_at ?? null,
      input.duration_min ?? null,
      input.label,
      input.summary,
      input.body ?? null,
      status,
      input.transcript_kind ?? null,
      input.transcript_path ?? null,
      input.transcript_offset ?? null,
      input.transcript_length ?? null
    );

    const row = this.getById(id);
    if (row === null) {
      // Unreachable: we just inserted/replaced the row. Surface a clear
      // error rather than returning a silently-bad null.
      throw new Error(`upsert() wrote row ${id} but getById returned null`);
    }
    return row;
  }

  /**
   * Look up a single session by id. Returns the full row (including
   * `body`) or `null` if the row does not exist.
   */
  getById(id: string): Session | null {
    const stmt = this.db.prepare('SELECT * FROM sessions WHERE id = ?');
    const row = stmt.get(id);
    if (row === undefined || row === null) {
      return null;
    }
    return rowToSession(row);
  }

  /**
   * Digest search. Returns rows newest-first WITHOUT the `body` field —
   * the `body` column (full transcript markdown) is loaded lazily via
   * `getById()` when a caller actually needs it.
   *
   * Defaults: `limit = 10`. The `query` parameter is a case-insensitive
   * substring match (`LIKE %query%`) against `label` OR `summary`. The
   * `status` and `runtime` parameters are exact-match equality filters.
   *
   * The query is built branch-by-branch so the parameter list matches the
   * `?` placeholders in the SQL. Mirrors the `FactStore.recall()` pattern.
   */
  searchDigests(options?: DigestSearchOptions): Session[] {
    const query = options?.query;
    const runtime = options?.runtime;
    const status = options?.status;
    const limit = options?.limit ?? 10;

    const where: string[] = [];
    const params: unknown[] = [];

    if (query !== undefined) {
      where.push('(label LIKE ? OR summary LIKE ?)');
      params.push(`%${query}%`, `%${query}%`);
    }
    if (status !== undefined) {
      where.push('status = ?');
      params.push(status);
    }
    if (runtime !== undefined) {
      where.push('runtime = ?');
      params.push(runtime);
    }

    const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const sql = `SELECT ${SESSION_DIGEST_COLUMNS} FROM sessions ${whereClause} ORDER BY started_at DESC LIMIT ?`;

    params.push(limit);

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params);
    return rows.map((row) => rowToSession(row));
  }

  /**
   * Per-runtime recall: all sessions from a given runtime (claude-code,
   * hermes, opencode, ...), newest first. Returns FULL sessions including
   * the `body` field — callers using this method typically want the entire
   * timeline for a runtime, not a digest.
   *
   * Default `limit = 10`.
   */
  searchByRuntime(runtime: string, limit?: number): Session[] {
    const effectiveLimit = limit ?? 10;

    const stmt = this.db.prepare(
      'SELECT * FROM sessions WHERE runtime = ? ' +
        'ORDER BY started_at DESC LIMIT ?'
    );
    const rows = stmt.all(runtime, effectiveLimit);
    return rows.map((row) => rowToSession(row));
  }

  /**
   * Record a lineage edge between two sessions. Throws when
   * `fromSession === toSession` (a self-edge is meaningless in the
   * lineage DAG). `INSERT OR IGNORE` keeps the call idempotent — the
   * composite PK `(from_session, to_session, kind)` enforces uniqueness.
   *
   * Returns the edge row with its `created_at` populated by the database
   * default.
   */
  addEdge(
    fromSession: string,
    toSession: string,
    kind: SessionEdgeKind
  ): SessionEdge {
    if (fromSession === toSession) {
      throw new Error('session edge cannot be self-referential');
    }

    const stmt = this.db.prepare(
      'INSERT OR IGNORE INTO session_edges ' +
        '(from_session, to_session, kind, created_at) ' +
        "VALUES (?, ?, ?, datetime('now'))"
    );
    stmt.run(fromSession, toSession, kind);

    const edgeStmt = this.db.prepare(
      'SELECT * FROM session_edges ' +
        'WHERE from_session = ? AND to_session = ? AND kind = ?'
    );
    const row = edgeStmt.get(fromSession, toSession, kind);
    if (row === undefined || row === null) {
      // Unreachable: the row was just inserted (or already existed). If
      // this fires, the schema's PK / INSERT OR IGNORE contract broke.
      throw new Error(
        `addEdge() wrote (${fromSession}, ${toSession}, ${kind}) but the follow-up select returned null`
      );
    }
    return rowToSessionEdge(row);
  }

  /**
   * Walk the lineage graph for a session. The default
   * `direction = "both"` returns every edge the session participates in
   * (incoming + outgoing). `"parents"` restricts to edges pointing AT
   * this session (where it came from); `"children"` restricts to edges
   * pointing AWAY from it (what it spawned).
   *
   * `kinds` defaults to all 4 edge kinds. When narrowed, the `kind IN (...)`
   * clause is built as a locked-step `kind = ? OR kind = ? ...` chain
   * (one `?` per kind, params array grows in lockstep with the SQL).
   *
   * Returned rows are ordered by `created_at` then `(from_session, to_session)`
   * for a deterministic walk order.
   */
  getLineage(sessionId: string, options?: LineageOptions): SessionEdge[] {
    const direction = options?.direction ?? 'both';
    const kinds: SessionEdgeKind[] = options?.kinds ?? [
      'supersedes',
      'continues',
      'branched_from',
      'merged_from',
    ];

    const kindClause =
      kinds.length > 0 ? `(${kinds.map(() => 'kind = ?').join(' OR ')})` : '';
    const kindParams: unknown[] = [...kinds];

    let sql: string;
    let params: unknown[];

    if (direction === 'parents') {
      // Edges pointing AT this session — `to_session = sessionId`.
      sql = `SELECT * FROM session_edges WHERE to_session = ? ${kindClause ? `AND ${kindClause} ` : ''}ORDER BY created_at, from_session, to_session`;
      params = [sessionId, ...kindParams];
    } else if (direction === 'children') {
      // Edges pointing AWAY from this session — `from_session = sessionId`.
      sql = `SELECT * FROM session_edges WHERE from_session = ? ${kindClause ? `AND ${kindClause} ` : ''}ORDER BY created_at, from_session, to_session`;
      params = [sessionId, ...kindParams];
    } else {
      // Both directions: the session is on either end of the edge.
      sql = `SELECT * FROM session_edges WHERE (from_session = ? OR to_session = ?) ${kindClause ? `AND ${kindClause} ` : ''}ORDER BY created_at, from_session, to_session`;
      params = [sessionId, sessionId, ...kindParams];
    }

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params);
    return rows.map((row) => rowToSessionEdge(row));
  }

  /**
   * Flat edge lookup for a single session. Unlike `getLineage()`, this
   * method does NOT restrict to a directional traversal — it returns every
   * edge the session appears on (incoming OR outgoing) in one query.
   *
   * When `kind` is provided, the result is filtered to that single kind.
   * The default (no `kind`) returns edges of any kind, including all 4
   * from the closed vocabulary.
   */
  getEdges(sessionId: string, kind?: SessionEdgeKind): SessionEdge[] {
    let sql: string;
    let params: unknown[];

    if (kind !== undefined) {
      sql =
        'SELECT * FROM session_edges ' +
        'WHERE (from_session = ? OR to_session = ?) ' +
        'AND kind = ? ' +
        'ORDER BY created_at, from_session, to_session';
      params = [sessionId, sessionId, kind];
    } else {
      sql =
        'SELECT * FROM session_edges ' +
        'WHERE from_session = ? OR to_session = ? ' +
        'ORDER BY created_at, from_session, to_session';
      params = [sessionId, sessionId];
    }

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params);
    return rows.map((row) => rowToSessionEdge(row));
  }

  /**
   * Mark `predecessorId` as superseded by `successorId` and record the
   * supersedence edge. Both session rows must already exist.
   *
   * Throws when:
   *   - the predecessor row is missing,
   *   - the predecessor is already superseded (supersedence is a
   *     single-step edge in the append-only DAG),
   *   - the successor row is missing.
   *
   * The `reason` field is accepted for parity with nlm-memory's
   * `markSupersededHandler` (MCP tool description documents it as
   * "logged to the supersedence audit log for provenance") but is
   * NOT YET PERSISTED in Phase 2.2. A future phase adds a
   * `supersedence_log` table per nlm-memory's
   * `core/storage/supersedence-log.ts`; this method will then record
   * `(predecessorId, successorId, reason, source, recordedAt)` to that
   * table. For now the reason is dropped.
   *
   * Idempotent on the edge: `INSERT OR IGNORE` means re-marking the same
   * pair does not raise a uniqueness error. The status flip and edge
   * insert are NOT wrapped in a transaction here (each statement is
   * individually idempotent).
   */
  markSuperseded(input: MarkSupersededInput): void {
    const predecessor = this.getById(input.predecessorId);
    if (predecessor === null) {
      throw new Error(`predecessor session not found: ${input.predecessorId}`);
    }
    if (predecessor.status === 'superseded') {
      throw new Error('predecessor is already superseded');
    }

    const successor = this.getById(input.successorId);
    if (successor === null) {
      throw new Error(`successor session not found: ${input.successorId}`);
    }

    // TODO(phase-supersedence-log): persist `input.reason` to a
    // `supersedence_log` table mirroring nlm-memory's
    // `core/storage/supersedence-log.ts`. Phase 2.2 accepts the field
    // for API parity but drops the value.
    void input.reason;

    const updateStmt = this.db.prepare(
      "UPDATE sessions SET status = 'superseded', updated_at = datetime('now') " +
        'WHERE id = ?'
    );
    updateStmt.run(input.predecessorId);

    const edgeStmt = this.db.prepare(
      'INSERT OR IGNORE INTO session_edges ' +
        '(from_session, to_session, kind, created_at) ' +
        "VALUES (?, ?, 'supersedes', datetime('now'))"
    );
    edgeStmt.run(input.predecessorId, input.successorId);
  }
}
