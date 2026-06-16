// Phase 6.1 migration 007: the `profiles` table and the 3 read-path
// indexes the resolver and future `singularity profile list` CLI
// command will hit on name lookup, default-agent resolution, and
// time-ordered listing.
//
// This migration composes the table definition from `../schema.sql.ts`
// (no duplication of the `CREATE TABLE` body) and adds the 3 indexes
// the runtime needs. All statements are `IF NOT EXISTS` so re-running
// the migration against a database where the schema is already
// applied is a no-op.
//
// Index naming mirrors the `idx_<table>_<column>` convention used by
// the memory migrations (`003_sessions_and_edges.sql.ts`,
// `004_fact_session_fk.sql.ts`) and the approvals migration
// (`006_approvals.sql.ts`) so a future "diff memory vs approvals vs
// profiles" review stays mechanical.
//
// What is intentionally NOT here:
//   - No FK from `profiles.default_agent_id` to an `agents(id)` table.
//     The `agents` table lands in a later phase; a hard FK now would
//     block this migration from applying to a fresh profile DB that
//     has no `agents` table yet. The `default_agent_id` column is a
//     soft reference today.
//   - No `agents` table. The FK target lands in a future phase.
//   - No credential / secret columns. The `profiles` table holds no
//     API keys, tokens, passwords, or any other secret-bearing field.
//     Per `docs/SPEC.md` line 50, secrets live in a future encrypted
//     credential store; this table holds REFERENCES only.
//   - No trigger / view / FTS5 / vec0 virtual table. The profiles
//     table is intentionally minimal; session-scoped search and
//     memory embeddings attach in their own migrations.

import { PROFILES_TABLE_SQL } from '../schema.sql.js';

export const MIGRATION_007_SQL = `
${PROFILES_TABLE_SQL}

-- Hot path: resolver 'resolve(name)' lookup. The 'name' column
-- already carries a UNIQUE constraint, so a dedicated index keeps the
-- read path O(log n) regardless of the table's row count. The same
-- index also serves 'ProfileStore.getByName(name)'.
CREATE INDEX IF NOT EXISTS idx_profiles_name
  ON profiles(name);

-- "What is the default agent for this profile?" — used by Phase 6.x
-- agent resolution. The partial predicate ('WHERE default_agent_id IS
-- NOT NULL') keeps the index small: most profiles will not have a
-- default agent set until Phase 6.x wires the agents table, and the
-- index will only cover the rows that actually carry a reference.
CREATE INDEX IF NOT EXISTS idx_profiles_default_agent
  ON profiles(default_agent_id)
  WHERE default_agent_id IS NOT NULL;

-- Time-ordered listing for the future 'singularity profile list' CLI
-- (Phase 7). Mirrors the 'sessions.created_at' listing pattern used
-- by 'SessionStore.searchDigests' in Phase 2.2.
CREATE INDEX IF NOT EXISTS idx_profiles_created_at
  ON profiles(created_at DESC);
`;
