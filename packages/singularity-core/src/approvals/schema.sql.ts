// Phase 4.2 approvals schema — canonical schema for singularity-core approvals.
//
// Source of truth: the Phase 4.2 plan in IMPLEMENTATION_PLAN.md (Task 2.1).
// The `approvals` table records every decision the policy engine renders
// against a tool call: the requested action, the resource it targets, the
// effect that was requested, the decision itself, who decided (human,
// `auto` rule, or `default`), when the decision was rendered, and whether
// the user opted to save the ruling as a reusable rule (`once` vs `saved`).
//
// `decision` is constrained to the three policy outcomes (`allow`, `ask`,
// `deny`) so the decision ledger cannot accumulate junk that downstream
// summarisation would have to filter out. `save_rule` is constrained to
// `once` (one-shot decision, not persisted as a reusable rule) or `saved`
// (persisted into the `rules` table that Phase 4.3 introduces).
//
// `metadata_json` is a free-form JSON column for policy-engine diagnostics
// (matched rule id, reason string, machine-readable context) and is
// intentionally untyped at the SQL layer — the policy layer is responsible
// for serialising and parsing it.
//
// `CREATE TABLE IF NOT EXISTS` keeps the migration idempotent: the same
// statement is safe to re-run against a database where the schema is
// already applied (e.g. on subsequent boots or in tests).
export const APPROVALS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS approvals (
  id                TEXT PRIMARY KEY,
  session_id        TEXT NOT NULL,
  action            TEXT NOT NULL,
  resource          TEXT,
  effect_requested  TEXT NOT NULL,
  decision          TEXT NOT NULL CHECK (decision IN ('allow', 'ask', 'deny')),
  decided_by        TEXT NOT NULL,
  decided_at        TEXT NOT NULL DEFAULT (datetime('now')),
  reason            TEXT NOT NULL DEFAULT '',
  save_rule         TEXT NOT NULL CHECK (save_rule IN ('once', 'saved')),
  metadata_json     TEXT
);
`;
