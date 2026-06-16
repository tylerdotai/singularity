// Phase 2.1 facts table — canonical schema for singularity-core memory.
//
// Source of truth: nlm-memory/migrations/004_facts.sql (Apache-2.0).
// Ported verbatim with two documented divergences:
//   1. `source_session_id` and `superseded_by` are plain TEXT columns with no
//      FOREIGN KEY constraints. The `sessions` table lands in Phase 2.2, so
//      a REFERENCES clause would fail to apply. Soft reference until then.
//   2. The `fact_embeddings` vec0 virtual table is NOT created here. That
//      lands in Phase 2.3 alongside semantic recall wiring. Creating it now
//      would pull the vec0 extension requirement forward by two phases.
//
// Column order, CHECK constraints, and default for `created_at` are kept
// identical to nlm-memory so the same classifier output (subject, predicate,
// value, kind, confidence) writes cleanly to either backend.

export const FACTS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS facts (
  id                 TEXT PRIMARY KEY,
  kind               TEXT NOT NULL CHECK (kind IN ('decision', 'open', 'attribute')),
  subject            TEXT NOT NULL,
  predicate          TEXT NOT NULL,
  value              TEXT NOT NULL,
  source_session_id  TEXT NOT NULL,
  source_quote       TEXT,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  superseded_by      TEXT,
  confidence         REAL NOT NULL CHECK (confidence >= 0.0 AND confidence <= 1.0)
);
`;
