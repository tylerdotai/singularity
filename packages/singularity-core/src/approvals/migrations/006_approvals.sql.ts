// Phase 4.2 migration 006: `approvals` table and the 4 read-path indexes
// the policy engine and audit surface will hit on per-session history,
// per-action grouping, per-decision filtering, and time-ordered replay.
//
// This migration composes the table definition from `../schema.sql.ts`
// (no duplication of the `CREATE TABLE` body) and adds the 4 indexes the
// runtime needs. All statements are `IF NOT EXISTS` so re-running the
// migration against a database where the schema is already applied is a
// no-op.
//
// Index naming mirrors the `idx_<table>_<column>` convention used by
// the memory migrations (`003_sessions_and_edges.sql.ts`,
// `004_fact_session_fk.sql.ts`) so a future "diff memory vs approvals"
// review stays mechanical.
//
// What is intentionally NOT here:
//   - No `rules` table. The `approvals.save_rule` column records whether
//     a ruling was persisted as a reusable rule (`'saved'`) or one-shot
//     (`'once'`), but the `rules` table itself lands in Phase 4.3.
//   - No FTS5 virtual table for approval text. Phase 4.2 ships the
//     decision ledger only; full-text search across `action` /
//     `resource` / `metadata_json` is a later phase.
//   - No foreign key from `approvals.session_id` to `memory.sessions(id)`.
//     The memory schema lives in a separate connection boundary and a
//     cross-package FK is intentionally avoided here.

import { APPROVALS_TABLE_SQL } from '../schema.sql.js';

export const MIGRATION_006_SQL = `
${APPROVALS_TABLE_SQL}

-- Hot path: "show me every decision for this session" — drives the
-- per-session audit view and the session-scoped recall surface.
CREATE INDEX IF NOT EXISTS idx_approvals_session
  ON approvals(session_id);

-- "How many times have we seen this action?" — drives per-action
-- grouping in the policy analytics surface and the rule-suggestion
-- sweep that Phase 4.3 introduces.
CREATE INDEX IF NOT EXISTS idx_approvals_action
  ON approvals(action);

-- "Show me every deny / ask / allow ruling" — drives the outcome
-- filter on the decision ledger (e.g. "all deny decisions in the last
-- 24h") and the auto-rule candidate mining that Phase 4.3 introduces.
CREATE INDEX IF NOT EXISTS idx_approvals_decision
  ON approvals(decision);

-- Time-ordered replay: "what was the most recent decision?" / "what
-- happened in this window?" — drives the per-session decision timeline
-- and the audit-export ordered stream.
CREATE INDEX IF NOT EXISTS idx_approvals_decided_at
  ON approvals(decided_at);
`;
