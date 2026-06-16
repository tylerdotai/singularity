// Phase 2.2 sessions schema — canonical schema for singularity-core memory.
//
// Source of truth: nlm-memory/migrations/000_initial_schema.sql (Apache-2.0).
// The `sessions` and `session_edges` table definitions are ported verbatim
// from lines 14-32 and 89-94 of that file. Column order, CHECK constraints,
// defaults, and FK actions are kept byte-identical so the same ingest path
// (a runtime emitting a transcript + a hermes-derived digest) writes
// cleanly to either backend.
//
// The `body` column is the full markdown transcript. It is nullable on
// purpose: digest-time search reads `summary` + `label` + `transcript_path`
// and does not need the full body materialized. The body is loaded lazily
// on demand (e.g. when a later phase replays or quotes the session).
//
// Both tables use `CREATE TABLE IF NOT EXISTS` so the migration is
// idempotent and safe to re-run against a database where the schema is
// already applied.

export const SESSIONS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS sessions (
  id                  TEXT PRIMARY KEY,
  runtime             TEXT NOT NULL,
  runtime_session_id  TEXT,
  started_at          TEXT NOT NULL,
  ended_at            TEXT,
  duration_min        INTEGER,
  label               TEXT NOT NULL,
  summary             TEXT NOT NULL,
  body                TEXT,
  status              TEXT NOT NULL CHECK (status IN ('active', 'closed', 'superseded')),
  transcript_kind     TEXT,
  transcript_path     TEXT,
  transcript_offset   INTEGER,
  transcript_length   INTEGER,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

// Phase 2.2 session_edges schema.
//
// Source of truth: nlm-memory/migrations/000_initial_schema.sql (Apache-2.0),
// lines 89-94. Edges form the session lineage graph: parent/child,
// continuation, branching, and merge relationships. The composite primary
// key `(from_session, to_session, kind)` makes the table idempotent for
// `INSERT OR IGNORE` semantics — duplicate edges are silently dropped.
//
// `ON DELETE CASCADE` matches nlm-memory: when a session row is removed,
// every edge that references it (in either direction) is removed with it.
// This keeps the lineage graph consistent without an explicit cleanup pass.
export const SESSION_EDGES_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS session_edges (
  from_session  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  to_session    TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('supersedes', 'continues', 'branched_from', 'merged_from')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (from_session, to_session, kind)
);
`;
