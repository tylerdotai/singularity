// Phase 2.2 migration 003: `sessions` table, `session_edges` table, and
// their read-path indexes.
//
// This migration composes the two table definitions from
// `../sessions.sql.ts` (no duplication) and adds the 6 read-path indexes
// the runtime will hit on digest, lineage traversal, and per-runtime
// filtering. All statements are `IF NOT EXISTS` so re-running the
// migration against a database where the schema is already applied is a
// no-op.
//
// Index naming mirrors nlm-memory's `migrations/000_initial_schema.sql`
// lines 35-87 so a future "diff nlm-memory vs singularity" review stays
// mechanical.
//
// What is intentionally NOT here:
//   - No FTS5 virtual table (`sessions_fts`). That lands alongside the
//     semantic recall work in Phase 2.3 once the search surface is real.
//   - No `session_embeddings` vec0 table. Same reason — vec0 requires
//     the sqlite-vec extension to be loaded by every connection, and we
//     do not want to force that dependency on the digest path.
//   - No `entities` / `markers` / `actions` / `session_entities` tables.
//     The Phase 2.2 scope is sessions + their lineage graph + the FK
//     conversion in migration 004. Cross-session entity linking is a
//     later phase.

import {
  SESSION_EDGES_TABLE_SQL,
  SESSIONS_TABLE_SQL,
} from '../sessions.sql.js';

export const MIGRATION_003_SQL = `
${SESSIONS_TABLE_SQL}

${SESSION_EDGES_TABLE_SQL}

-- Hot path: "show me the most recent sessions" — newest first.
CREATE INDEX IF NOT EXISTS idx_sessions_started_at
  ON sessions(started_at DESC);

-- "Which sessions are still active / already closed / superseded?"
-- Drives the digest queue and the lineage-prune sweep.
CREATE INDEX IF NOT EXISTS idx_sessions_status
  ON sessions(status);

-- "Show me everything from this runtime (claude-code, hermes, opencode, ...)."
-- Lets the per-runtime recall surface stay partitioned.
CREATE INDEX IF NOT EXISTS idx_sessions_runtime
  ON sessions(runtime);

-- Lineage traversal: "where did this session come from?" — outgoing edges.
CREATE INDEX IF NOT EXISTS idx_session_edges_from
  ON session_edges(from_session);

-- Lineage traversal: "what did this session spawn?" — incoming edges.
CREATE INDEX IF NOT EXISTS idx_session_edges_to
  ON session_edges(to_session);

-- "What kind of edges connect these two sessions?" — kind-only lookups
-- (e.g. "find all supersedes edges in the last 30 days").
CREATE INDEX IF NOT EXISTS idx_session_edges_kind
  ON session_edges(kind);
`;
