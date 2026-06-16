// Phase 2.3 migration 005: FTS5 virtual table + 3 triggers for the
// sessions table.
//
// Source of truth: nlm-memory/migrations/000_initial_schema.sql:100-123
// (Apache-2.0). The FTS5 index covers `label` + `summary` + `body`, with
// the content sourced from the `sessions` table via the `content='sessions'`
// + `content_rowid='rowid'` directives. The 3 triggers keep the index in
// sync with inserts, updates, and deletes on `sessions`.
//
// IMPORTANT: SQLite must be compiled with `-DSQLITE_ENABLE_FTS5` for this
// migration to succeed. If FTS5 is not available, this migration is a hard
// error at apply time. Run Fts5SessionSearch.isAvailable(db) BEFORE running
// this migration to detect FTS5 support; if false, skip the migration
// (a future phase adds a `skipFts5` option to the migration runner).
//
// Like the other migrations, all statements are `IF NOT EXISTS` so the
// migration is idempotent.

export const MIGRATION_005_SQL = `
CREATE VIRTUAL TABLE IF NOT EXISTS sessions_fts USING fts5(
  label, summary, body,
  content='sessions',
  content_rowid='rowid'
);

CREATE TRIGGER IF NOT EXISTS sessions_ai AFTER INSERT ON sessions BEGIN
  INSERT INTO sessions_fts(rowid, label, summary, body)
  VALUES (new.rowid, new.label, new.summary, new.body);
END;

CREATE TRIGGER IF NOT EXISTS sessions_au AFTER UPDATE ON sessions BEGIN
  INSERT INTO sessions_fts(sessions_fts, rowid, label, summary, body)
  VALUES('delete', old.rowid, old.label, old.summary, old.body);
  INSERT INTO sessions_fts(rowid, label, summary, body)
  VALUES (new.rowid, new.label, new.summary, new.body);
END;

CREATE TRIGGER IF NOT EXISTS sessions_ad AFTER DELETE ON sessions BEGIN
  INSERT INTO sessions_fts(sessions_fts, rowid, label, summary, body)
  VALUES('delete', old.rowid, old.label, old.summary, old.body);
END;
`;
