// Phase 2.1 migration 002: the `fact_history` view.
//
// Newest-first projection over the `facts` table. Used by the history UI
// (Phase 2.4) and by any test that asserts chronological recall order
// without manually sorting. The view is intentionally a thin wrapper:
// filtering by `superseded_by IS NULL` lives in the read-side query, not
// here, so callers can decide whether they want the full audit trail
// (current + tombstoned rows) or just the live set.
//
// `CREATE VIEW IF NOT EXISTS` makes this idempotent — re-running the
// migration after the view already exists is a no-op, matching the
// behavior of the index / table statements in migration 001.

export const MIGRATION_002_SQL = `
CREATE VIEW IF NOT EXISTS fact_history AS
  SELECT * FROM facts
  ORDER BY created_at DESC;
`;
