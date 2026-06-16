// Phase 2.1 migrations barrel.
//
// The runner in Phase 2.1 (sqlite-migrate or equivalent) will iterate
// `MIGRATIONS` in order, execute each entry's `sql` against the open
// connection inside a transaction, and record the applied version in its
// own bookkeeping table. Entries here are append-only; new migrations
// become 003, 004, ... in source order.

import { MIGRATION_001_SQL } from './001_initial_facts.sql.js';
import { MIGRATION_002_SQL } from './002_fact_history_view.sql.js';
import { MIGRATION_003_SQL } from './003_sessions_and_edges.sql.js';
import { MIGRATION_004_SQL } from './004_fact_session_fk.sql.js';
import { MIGRATION_005_SQL } from './005_sessions_fts.sql.js';

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: '001_initial_facts',
    sql: MIGRATION_001_SQL,
  },
  {
    version: 2,
    name: '002_fact_history_view',
    sql: MIGRATION_002_SQL,
  },
  {
    version: 3,
    name: '003_sessions_and_edges',
    sql: MIGRATION_003_SQL,
  },
  {
    version: 4,
    name: '004_fact_session_fk',
    sql: MIGRATION_004_SQL,
  },
  {
    version: 5,
    name: '005_sessions_fts',
    sql: MIGRATION_005_SQL,
  },
];
