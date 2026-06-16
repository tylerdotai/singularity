// Phase 2.2 migration 004: convert `facts.source_session_id` from a plain
// TEXT soft reference to a real FOREIGN KEY referencing `sessions(id)`.
//
// The Phase 2.1 `facts` table was deliberately shipped with `source_session_id`
// as plain TEXT (no REFERENCES clause) because the `sessions` table did
// not exist yet — a foreign key to a non-existent table is a hard error
// in SQLite, and we did not want to gate the facts schema on the sessions
// schema. Migration 004 closes that loop: by the time this migration runs,
// migration 003 has already created `sessions`, so adding the FK is safe.
//
// Why the recreate-table pattern: SQLite does not support
// `ALTER TABLE ... ADD CONSTRAINT FOREIGN KEY` for an already-populated
// table. The standard workaround is:
//   1. PRAGMA foreign_keys = OFF (defer FK enforcement for the dance).
//   2. Rename the old table to `facts_old`.
//   3. Re-create the table with the new schema (FK added).
//   4. INSERT ... SELECT to copy data from `facts_old` to `facts`.
//   5. Re-create the 3 indexes from migration 001.
//   6. Re-create the `fact_history` view from migration 002.
//   7. DROP TABLE `facts_old`.
//   8. PRAGMA foreign_keys = ON (re-enable enforcement for the connection).
//
// `PRAGMA` inside a migration is supported by SQLite and is scoped to the
// connection that runs the migration. After this migration completes,
// FK enforcement is restored, and any future INSERT into `facts` with a
// non-existent `source_session_id` will be rejected with a constraint
// error. `ON DELETE CASCADE` means deleting a session row also drops
// every fact sourced from it — there is no orphan-facts scenario.
//
// Note on `facts.superseded_by`: that column is intentionally NOT a FK.
// It is a value-edge self-reference (a fact id pointing at the fact
// that replaced it) with no target table to point at. The data model
// uses the value as a logical pointer; the supersedence check on ingest
// is enforced application-side, not by the database.

export const MIGRATION_004_SQL = `
PRAGMA foreign_keys = OFF;

ALTER TABLE facts RENAME TO facts_old;

CREATE TABLE facts (
  id                 TEXT PRIMARY KEY,
  kind               TEXT NOT NULL CHECK (kind IN ('decision', 'open', 'attribute')),
  subject            TEXT NOT NULL,
  predicate          TEXT NOT NULL,
  value              TEXT NOT NULL,
  source_session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  source_quote       TEXT,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  superseded_by      TEXT,
  confidence         REAL NOT NULL CHECK (confidence >= 0.0 AND confidence <= 1.0)
);

INSERT INTO facts (
  id, kind, subject, predicate, value,
  source_session_id, source_quote, created_at, superseded_by, confidence
)
SELECT
  id, kind, subject, predicate, value,
  source_session_id, source_quote, created_at, superseded_by, confidence
FROM facts_old;

-- Re-create the 3 indexes from migration 001. The "IF NOT EXISTS"
-- clause on each statement makes the re-create safe even if a future
-- migration runner happens to apply this script twice.
CREATE INDEX IF NOT EXISTS idx_facts_subject_predicate_current
  ON facts(subject, predicate)
  WHERE superseded_by IS NULL;

CREATE INDEX IF NOT EXISTS idx_facts_subject_current
  ON facts(subject)
  WHERE superseded_by IS NULL;

CREATE INDEX IF NOT EXISTS idx_facts_session
  ON facts(source_session_id);

-- Re-create the fact_history view from migration 002.
CREATE VIEW IF NOT EXISTS fact_history AS
  SELECT * FROM facts
  ORDER BY created_at DESC;

DROP TABLE facts_old;

PRAGMA foreign_keys = ON;
`;
