// Phase 2.1 test fixture — in-memory SQLite + FactStore.
//
// `createTestDb()` produces a fresh, fully-migrated `FactStore` backed by an
// in-memory `bun:sqlite` database. The function is intentionally side-effect
// free: it never mutates global state, and each call yields an independent DB
// (`:memory:` databases are isolated per connection in SQLite). Tests should
// invoke it inside `beforeEach` so a regression in one `it(...)` block cannot
// leak state into the next.
//
// Why `bun:sqlite` and not `better-sqlite3`?
//   The test fixture runs in-process under `bun test`. `bun:sqlite` is built
//   into Bun 1.3.x and supports `:memory:` databases with no native compile
//   step. `better-sqlite3` would require a prebuilt binding for the host's
//   Bun/Node version, which adds friction for no functional gain at the unit
//   test layer — the production runtime (which uses `better-sqlite3` for
//   file-backed persistence) shares the same minimal SQL surface
//   (`prepare` + `exec`) that `bun:sqlite` exposes.

import { Database } from 'bun:sqlite';

import { FactStore } from '../src/memory/facts.ts';
import { MIGRATIONS } from '../src/memory/migrations/index.ts';
import {
  type CreateSessionInput,
  type Session,
  SessionStore,
} from '../src/memory/sessions.ts';

/**
 * Create a fresh in-memory SQLite database, apply every migration in
 * `MIGRATIONS` (001-004 as of Phase 2.2), and return the open handle
 * alongside ready-to-use `FactStore` and `SessionStore` instances.
 *
 * Callers are expected to call this inside `beforeEach`. Each call yields an
 * independent database — there is no shared state between tests.
 */
export function createTestDb(): {
  db: Database;
  factStore: FactStore;
  sessionStore: SessionStore;
} {
  const db = new Database(':memory:');
  const factStore = new FactStore(db);
  const sessionStore = new SessionStore(db);
  // Run all 4 migrations (001-004) via the fact store's migrate().
  factStore.migrate();
  return { db, factStore, sessionStore };
}

/**
 * Insert a minimal session row to satisfy the FK on `facts.source_session_id`.
 *
 * Migration 004 converts `facts.source_session_id` from a soft TEXT reference
 * to a real `FOREIGN KEY REFERENCES sessions(id) ON DELETE CASCADE`. Tests
 * that insert facts must therefore have a matching `sessions` row first —
 * this helper provides that row with a fixed id (when supplied) or a random
 * `sess_stub_<8 hex>` id (when not).
 *
 * Returns the full `Session` row as read back through `getById` so callers
 * see the canonical `created_at` / `updated_at` values the database
 * persisted.
 */
export function insertStubSession(store: SessionStore, id?: string): Session {
  const sessionId =
    id ?? `sess_stub_${Math.random().toString(36).slice(2, 10)}`;
  const input: CreateSessionInput = {
    id: sessionId,
    runtime: 'test',
    started_at: '2026-01-01T00:00:00Z',
    label: `Stub session ${sessionId}`,
    summary: 'Stub session for FK tests',
  };
  return store.upsert(input);
}
