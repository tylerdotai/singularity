// Phase 2.1 — `FactStore`: SQLite-backed fact memory store.
//
// Schema: `packages/singularity-core/src/memory/facts.sql.ts`
//   The `facts` table mirrors nlm-memory's `migrations/004_facts.sql` (Apache-2.0)
//   verbatim, with two documented divergences:
//     1. `source_session_id` and `superseded_by` are plain TEXT columns with
//        no FOREIGN KEY. They are SOFT REFERENCES — the `sessions` table
//        lands in Phase 2.2, so a REFERENCES clause would fail to apply.
//     2. The `fact_embeddings` vec0 virtual table is NOT created here; it
//        lands in Phase 2.3 alongside semantic recall. Pulling the vec0
//        extension requirement forward would couple Phase 2.1 to sqlite-vec.
//
// Append-only model:
//   Facts are never deleted. Correction flows through `supersede()`: the
//   successor row is `create()`d, then `supersede(predecessorId, successorId)`
//   points the predecessor's `superseded_by` column at the new id. Recall
//   filters out tombstoned rows by default; `history()` returns the full
//   audit trail (current + tombstoned) for a subject.
//
// Migrations:
//   `migrate()` runs every entry in `MIGRATIONS` (in source order) via
//   `db.exec`. Idempotent because each statement uses `IF NOT EXISTS`.
//
// Database shim:
//   `FactStoreDatabase` is the minimum common surface shared by `bun:sqlite`
//   and `better-sqlite3` — `prepare` (with `run` / `all` / `get`) and `exec`.
//   Neither backend is imported here; callers pass whichever the runtime
//   already has open.

import { MIGRATIONS } from './migrations/index.js';

// ---------- Types ----------

export type FactKind = 'decision' | 'open' | 'attribute';

export interface Fact {
  id: string;
  kind: FactKind;
  subject: string;
  predicate: string;
  value: string;
  source_session_id: string;
  source_quote: string | null;
  created_at: string;
  superseded_by: string | null;
  confidence: number;
}

export interface CreateFactInput {
  kind: FactKind;
  subject: string;
  predicate: string;
  value: string;
  source_session_id: string;
  source_quote: string | null;
  confidence: number;
}

export interface RecallOptions {
  includeSuperseded?: boolean;
  minConfidence?: number;
  limit?: number;
}

export interface HistoryOptions {
  predicate?: string;
  limit?: number;
}

// Minimum common surface of `bun:sqlite` and `better-sqlite3`. Both expose
// `prepare(sql)` returning an object with `run`/`all`/`get`, and `exec(sql)`
// for multi-statement scripts.
export interface FactStoreDatabase {
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
 * Cast a raw row from `SELECT * FROM facts` into a `Fact`.
 *
 * The column set of the `facts` table (see `facts.sql.ts`) is a superset of
 * the `Fact` interface by construction: every field in `Fact` is a column
 * and every column is a field. The cast is therefore safe — we trust the
 * schema, not the row.
 */
function rowToFact(row: unknown): Fact {
  return row as unknown as Fact;
}

/**
 * Generate a unique id for a fact row. Uses `Math.random()`-based hex because
 * the singularity-core tsconfig ships with `lib: ["ES2022"]` only — neither
 * `Web Crypto` (DOM) nor `node:crypto` is in the type surface here. The id is
 * a 32-character hex string prefixed with `fact_`, giving 128 bits of entropy
 * with a readable prefix. Two facts generated in the same tick can collide
 * only in adversarial conditions; for the in-process test fixture and the
 * single-process FactStore usage of Phase 2.1, this is more than enough.
 */
function generateId(): string {
  const bytes = new Array<number>(16);
  for (let i = 0; i < 16; i++) {
    bytes[i] = Math.floor(Math.random() * 256);
  }
  return bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
}

export class FactStore {
  private readonly db: FactStoreDatabase;

  constructor(db: FactStoreDatabase) {
    this.db = db;
  }

  /**
   * Apply every migration in `MIGRATIONS` in order, inside a single
   * `try` block. Each statement is idempotent (`IF NOT EXISTS`), so this
   * is safe to call repeatedly.
   */
  migrate(): void {
    for (const migration of MIGRATIONS) {
      try {
        this.db.exec(migration.sql);
      } catch (err) {
        // Surface the failing migration version + name in the error so the
        // caller's stack trace points at the right file.
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(
          `migration v${migration.version} (${migration.name}) failed: ${message}`
        );
      }
    }
  }

  /**
   * Insert a new fact. Validates `confidence ∈ [0.0, 1.0]` and enforces the
   * high-confidence source-quote requirement (a fact with confidence ≥ 0.7
   * must carry a non-empty `source_quote` — that quote is what later audits
   * trust the row on).
   */
  create(input: CreateFactInput): Fact {
    if (input.confidence < 0.0 || input.confidence > 1.0) {
      throw new Error('confidence must be between 0.0 and 1.0');
    }

    const trimmedQuote = input.source_quote?.trim() ?? '';
    if (input.confidence >= 0.7 && trimmedQuote === '') {
      throw new Error(
        'source_quote is required for high-confidence facts (confidence >= 0.7)'
      );
    }

    const id = `fact_${generateId()}`;

    const stmt = this.db.prepare(
      `INSERT INTO facts (
         id, kind, subject, predicate, value,
         source_session_id, source_quote, confidence
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    stmt.run(
      id,
      input.kind,
      input.subject,
      input.predicate,
      input.value,
      input.source_session_id,
      input.source_quote,
      input.confidence
    );

    const created = this.getById(id);
    if (created === null) {
      // Unreachable: we just inserted the row. Surface a clear error rather
      // than returning a silently-bad null.
      throw new Error(`create() inserted row ${id} but getById returned null`);
    }
    return created;
  }

  /**
   * Mark `predecessorId` as superseded by `successorId`. The successor row
   * must already exist (caller is expected to `create()` it first).
   *
   * Throws if the predecessor is missing or is already tombstoned —
   * supersedence is a single-step edge in the append-only DAG.
   */
  supersede(predecessorId: string, successorId: string): void {
    const predecessor = this.getById(predecessorId);
    if (predecessor === null) {
      throw new Error(`predecessor fact not found: ${predecessorId}`);
    }
    if (predecessor.superseded_by !== null) {
      throw new Error(
        `predecessor is already superseded by ${predecessor.superseded_by}`
      );
    }

    const stmt = this.db.prepare(
      'UPDATE facts SET superseded_by = ? WHERE id = ?'
    );
    stmt.run(successorId, predecessorId);
  }

  /**
   * Recall facts for a (subject, predicate) pair, newest first.
   *
   * Defaults: `includeSuperseded = false`, `minConfidence = 0.6`, `limit = 10`.
   * The `subject` and `predicate` parameters are independently optional —
   * four combinations are valid (both / subject only / predicate only /
   * neither). The query is built branch-by-branch so the parameter list
   * matches the `?` placeholders in the SQL.
   */
  recall(
    subject?: string,
    predicate?: string,
    options?: RecallOptions
  ): Fact[] {
    const includeSuperseded = options?.includeSuperseded ?? false;
    const minConfidence = options?.minConfidence ?? 0.6;
    const limit = options?.limit ?? 10;

    const where: string[] = ['confidence >= ?'];
    const params: unknown[] = [minConfidence];

    if (subject !== undefined) {
      where.push('subject = ?');
      params.push(subject);
    }
    if (predicate !== undefined) {
      where.push('predicate = ?');
      params.push(predicate);
    }
    if (!includeSuperseded) {
      where.push('superseded_by IS NULL');
    }

    const sql = `SELECT * FROM facts WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT ?`;

    params.push(limit);

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params);
    return rows.map((row) => rowToFact(row));
  }

  /**
   * Full audit trail for a subject, newest first.
   *
   * Unlike `recall()`, `history()` does NOT filter by `superseded_by` — it
   * returns the entire subject timeline (current + tombstoned rows) so the
   * caller can render the supersedence chain. Default `limit = 100`.
   */
  history(subject: string, options?: HistoryOptions): Fact[] {
    const limit = options?.limit ?? 100;

    const where: string[] = ['subject = ?'];
    const params: unknown[] = [subject];

    if (options?.predicate !== undefined) {
      where.push('predicate = ?');
      params.push(options.predicate);
    }

    const sql = `SELECT * FROM facts WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT ?`;

    params.push(limit);

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params);
    return rows.map((row) => rowToFact(row));
  }

  /**
   * Look up a single fact by id. Returns `null` if the row does not exist.
   */
  getById(id: string): Fact | null {
    const stmt = this.db.prepare('SELECT * FROM facts WHERE id = ?');
    const row = stmt.get(id);
    if (row === undefined || row === null) {
      return null;
    }
    return rowToFact(row);
  }
}
