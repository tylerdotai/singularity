// Phase 6.1 profiles migrations barrel.
//
// The runner in `ProfileStore.migrate()` will iterate `MIGRATIONS` in
// order, execute each entry's `sql` against the open per-profile
// connection inside a transaction, and record the applied version in
// its own bookkeeping table. Entries here are append-only; new
// profiles migrations become 008, 009, ... in source order.
//
// Version 7 is the first profiles-subsystem entry. The memory
// migrations occupy 001-005 and the approvals migration occupies 006;
// phase 6.1 reserves 007 for the `profiles` table. The per-subsystem
// `MIGRATIONS` array is the source of truth for that subsystem — the
// memory and approvals `MIGRATIONS` arrays stay unchanged.

import { MIGRATION_007_SQL } from './007_profiles.sql.js';

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 7,
    name: '007_profiles',
    sql: MIGRATION_007_SQL,
  },
];
