// Phase 6.1 profiles table — canonical schema for the per-profile
// `state.db` opened by `ProfileResolver`.
//
// Source of truth: 'docs/ARCHITECTURE.md' lines 64-90. The 'profiles'
// table is the identity container that lives inside every per-profile
// SQLite database (one DB per profile, default at
// `~/.singularity/profiles/default/state.db`). The 6 fields below are
// the minimum needed to give a profile a name, a filesystem root, an
// optional default agent reference, and the two timestamps the rest of
// the runtime reads.
//
// 'name' carries a UNIQUE constraint so duplicate profile names are
// rejected at the DB layer even if a future caller bypasses
// 'ProfileStore.create()' validation. 'default_agent_id' is a plain
// nullable TEXT column with NO 'REFERENCES agents(id)' clause: the
// 'agents' table lands in a later phase and a hard FK now would block
// this schema from applying to a fresh profile DB that has no
// 'agents' table yet.
//
// What is intentionally NOT here:
//   - No credential / secret / API-key / token / password / private-key
//     column. Per `docs/SPEC.md` line 50, "No secrets in SQLite plaintext
//     except via explicit encrypted credential store." Provider
//     credentials are stored in a future encrypted credential store; the
//     `profiles` table holds REFERENCES only. The future
//     `provider_credentials_ref` column lands when the encrypted
//     credential store is designed.
//   - No FK to an `agents` table. The default agent is a soft reference
//     today; the FK target lands in Phase 6.x when the agents schema
//     is defined.
//   - No trigger / view / FTS5 / vec0 virtual table. The profiles
//     table is intentionally minimal; session-scoped search and
//     memory embeddings attach in their own migrations.
//
// `CREATE TABLE IF NOT EXISTS` keeps the migration idempotent: the
// same statement is safe to re-run against a database where the
// schema is already applied (e.g. on subsequent boots or in tests).
export const PROFILES_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS profiles (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL UNIQUE,
  root_path         TEXT NOT NULL,
  default_agent_id  TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
`;
