// Phase 6.1 — `ProfileStore`: SQLite-backed CRUD over the `profiles`
// table inside a single per-profile DB.
//
// Schema: `packages/singularity-core/src/profiles/schema.sql.ts`
//   The `profiles` table is the identity container for a profile per
//   `docs/ARCHITECTURE.md` lines 64-90. Six fields: `id`, `name`,
//   `root_path`, `default_agent_id`, `created_at`, `updated_at`.
//   `name` carries a UNIQUE constraint (duplicate names are rejected
//   at the DB layer even if a future caller bypasses the store's
//   validation). `default_agent_id` is a plain nullable TEXT with no
//   REFERENCES clause; the `agents` table lands in a later phase.
//
// Validation:
//   `create()` runs `validateProfileName()` BEFORE touching SQLite.
//   The regex `/^[a-zA-Z0-9_-]{1,64}$/` is the same character class
//   as the worktree slug (Phase 5.1) so a profile name is always a
//   valid directory name — the resolver can safely use `<name>` as
//   a path segment. The discriminator (`ProfileNameReason`) covers
//   `empty`, `too_long`, `path_traversal` (`.`, `..`, `/`, `\\`),
//   and `invalid_characters` (anything else outside the regex).
//
// Migrations:
//   `migrate()` runs every entry in `MIGRATIONS` (in source order)
//   via `db.exec`. Idempotent because each statement uses `IF NOT
//   EXISTS`. On failure the migration's `version` + `name` are
//   surfaced in the error message so the caller's stack trace points
//   at the right file.
//
// Database shim:
//   `ProfileStoreDatabase` is the minimum common surface shared by
//   `bun:sqlite` and `better-sqlite3` — `prepare` (with `run` / `all`
//   / `get`) and `exec`. Neither backend is imported here; callers
//   pass whichever the runtime already has open.

import { ProfileNameError, ProfileNotFoundError } from './errors.js';
import { MIGRATIONS } from './migrations/index.js';

// ---------- Types ----------

export interface Profile {
  id: string;
  name: string;
  root_path: string;
  default_agent_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateProfileInput {
  name: string;
  root_path?: string;
  default_agent_id?: string | null;
}

// Minimum common surface of `bun:sqlite` and `better-sqlite3`. Both
// expose `prepare(sql)` returning an object with `run`/`all`/`get`,
// and `exec(sql)` for multi-statement scripts.
export interface ProfileStoreDatabase {
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

// ---------- Helpers ----------

/**
 * The character class the resolver trusts as a directory name. The
 * `[a-zA-Z0-9_-]{1,64}` shape mirrors the worktree slug from
 * `src/workspace/worktree.ts` (Phase 5.1) so a profile name is always
 * safe to drop into `<profileRoot>/<name>/state.db`.
 */
const PROFILE_NAME_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;

/**
 * Cast a raw row from `SELECT * FROM profiles` into a `Profile`.
 *
 * The column set of the `profiles` table (see `schema.sql.ts`) is a
 * superset of the `Profile` interface by construction: every field
 * in `Profile` is a column and every column is a field. The cast is
 * therefore safe — we trust the schema, not the row.
 */
function rowToProfile(row: unknown): Profile {
  return row as unknown as Profile;
}

/**
 * Generate a unique id for a profile row. Uses `Math.random()`-based
 * hex because the singularity-core tsconfig ships with
 * `lib: ["ES2022"]` only — neither `Web Crypto` (DOM) nor
 * `node:crypto` is in the type surface here. The id is a 32-character
 * hex string prefixed with `prof_`, giving 128 bits of entropy with
 * a readable prefix. Two profiles generated in the same tick can
 * collide only in adversarial conditions; for the in-process test
 * fixture and the single-process `ProfileStore` usage of Phase 6.1,
 * this is more than enough.
 */
function generateProfileId(): string {
  const bytes = new Array<number>(16);
  for (let i = 0; i < 16; i++) {
    bytes[i] = Math.floor(Math.random() * 256);
  }
  return `prof_${bytes.map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Validate a profile name and throw a `ProfileNameError` with the
 * matching `ProfileNameReason` discriminator on failure. The order
 * of checks matters: `empty` is checked first so the empty string
 * reports as `empty` (not as a regex failure). `too_long` is checked
 * before the regex because the regex already enforces length — the
 * discriminator needs to be distinct. `path_traversal` (`.`, `..`,
 * `/`, `\\`) is checked explicitly so the test fixtures can
 * distinguish "the name is a known-bad shape" from "the name has an
 * arbitrary unsupported character".
 */
function validateProfileName(name: string): void {
  if (name.length === 0) {
    throw new ProfileNameError(name, 'empty');
  }
  if (name.length > 64) {
    throw new ProfileNameError(name, 'too_long');
  }
  if (
    name === '.' ||
    name === '..' ||
    name.includes('/') ||
    name.includes('\\')
  ) {
    throw new ProfileNameError(name, 'path_traversal');
  }
  if (!PROFILE_NAME_REGEX.test(name)) {
    throw new ProfileNameError(name, 'invalid_characters');
  }
}

// ---------- Implementation ----------

export class ProfileStore {
  private readonly db: ProfileStoreDatabase;

  constructor(db: ProfileStoreDatabase) {
    this.db = db;
  }

  /**
   * Apply every migration in `MIGRATIONS` in order, inside a single
   * `try` block. Each statement is idempotent (`IF NOT EXISTS`), so
   * this is safe to call repeatedly.
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
   * Insert a new profile. Validates `name` against
   * `validateProfileName()` BEFORE touching SQLite so callers never
   * see a `UNIQUE constraint failed: profiles.name` error for an
   * obviously-bad name (an empty string, a `..` traversal, etc.).
   * `root_path` defaults to `''` and `default_agent_id` defaults to
   * `null` when omitted.
   */
  create(input: CreateProfileInput): Profile {
    validateProfileName(input.name);

    const id = generateProfileId();
    const root_path = input.root_path ?? '';
    const default_agent_id = input.default_agent_id ?? null;

    const stmt = this.db.prepare(
      'INSERT INTO profiles (id, name, root_path, default_agent_id) VALUES (?, ?, ?, ?)'
    );
    stmt.run(id, input.name, root_path, default_agent_id);

    const created = this.getById(id);
    if (created === null) {
      // Unreachable: we just inserted the row. Surface a clear error
      // rather than returning a silently-bad null.
      throw new Error(`create() inserted row ${id} but getById returned null`);
    }
    return created;
  }

  /**
   * Look up a single profile by id. Returns `null` if the row does
   * not exist.
   */
  getById(id: string): Profile | null {
    const stmt = this.db.prepare('SELECT * FROM profiles WHERE id = ?');
    const row = stmt.get(id);
    if (row === undefined || row === null) {
      return null;
    }
    return rowToProfile(row);
  }

  /**
   * Look up a single profile by name. Returns `null` if the row does
   * not exist. The `name` column is UNIQUE, so the result is at
   * most one row.
   */
  getByName(name: string): Profile | null {
    const stmt = this.db.prepare('SELECT * FROM profiles WHERE name = ?');
    const row = stmt.get(name);
    if (row === undefined || row === null) {
      return null;
    }
    return rowToProfile(row);
  }

  /**
   * Return every profile, newest first. `ORDER BY created_at DESC`
   * matches the future `singularity profile list` CLI ordering
   * (Phase 7) and mirrors `SessionStore.searchDigests` (Phase 2.2).
   */
  list(): Profile[] {
    const stmt = this.db.prepare(
      'SELECT * FROM profiles ORDER BY created_at DESC'
    );
    const rows = stmt.all();
    return rows.map((row) => rowToProfile(row));
  }

  /**
   * Update `default_agent_id` and bump `updated_at` to the current
   * SQLite time. Returns the post-update row. Throws
   * `ProfileNotFoundError({ id })` if no row was changed — the
   * caller (a future CLI `singularity profile set-default-agent`)
   * gets a structured error instead of a silent no-op.
   */
  setDefaultAgent(id: string, agentId: string | null): Profile {
    const stmt = this.db.prepare(
      "UPDATE profiles SET default_agent_id = ?, updated_at = datetime('now') WHERE id = ?"
    );
    const result = stmt.run(agentId, id);
    if (result.changes === 0) {
      throw new ProfileNotFoundError({ id });
    }
    const updated = this.getById(id);
    if (updated === null) {
      // Defensive: the UPDATE reported a change, but the SELECT after
      // it returns nothing. Surface the same error rather than
      // returning a phantom null.
      throw new ProfileNotFoundError({ id });
    }
    return updated;
  }

  /**
   * Delete a profile by id. Throws `ProfileNotFoundError({ id })` if
   * no row was removed. The store does NOT cascade — there are no
   * other tables in Phase 6.1 that reference `profiles.id`; cascade
   * policy lands with the agents / sessions / skills tables in
   * later phases.
   */
  delete(id: string): void {
    const stmt = this.db.prepare('DELETE FROM profiles WHERE id = ?');
    const result = stmt.run(id);
    if (result.changes === 0) {
      throw new ProfileNotFoundError({ id });
    }
  }
}
