// Phase 2.1 migration 001: the `facts` table + its 3 read-path indexes.
//
// Source of truth: nlm-memory/migrations/004_facts.sql (Apache-2.0), lines
// 14-23 (table) and lines 26-39 (indexes). Index definitions are kept
// byte-identical to nlm-memory because the partial-index predicate
// (`WHERE superseded_by IS NULL`) is load-bearing for the supersedence
// collision check on ingest.
//
// The `fact_embeddings` vec0 virtual table from nlm-memory's migration 004
// is intentionally omitted — that is Phase 2.3. The trailing
// `INSERT OR IGNORE INTO schema_migrations` line from nlm-memory is also
// omitted because the migrations runner in Phase 2.1 records its own
// applied-version state; coupling the SQL to one specific bookkeeping
// table would be premature.

import { FACTS_TABLE_SQL } from '../facts.sql.js';

export const MIGRATION_001_SQL = `
${FACTS_TABLE_SQL}

-- Hot path: deterministic supersedence collision check on ingest
-- (subject, predicate) lookups against current rows only.
CREATE INDEX IF NOT EXISTS idx_facts_subject_predicate_current
  ON facts(subject, predicate)
  WHERE superseded_by IS NULL;

-- "What do we know about X?" — subject-only browsing.
CREATE INDEX IF NOT EXISTS idx_facts_subject_current
  ON facts(subject)
  WHERE superseded_by IS NULL;

-- Reverse lookup: which facts came from this session?
CREATE INDEX IF NOT EXISTS idx_facts_session
  ON facts(source_session_id);
`;
