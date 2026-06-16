// Phase 6.1 — profiles subsystem barrel.
//
// Public surface of `singularity-core/profiles`:
//   - errors: `ProfileNameError`, `ProfileNotFoundError`, `ProfileNameReason`
//     (shared module so the store and resolver throw the same classes
//     without a circular import)
//   - schema: `PROFILES_TABLE_SQL` constant (the `CREATE TABLE
//     profiles (...)` body; composed by migration 007)
//   - store: `ProfileStoreDatabase` (the minimum common SQLite surface
//     shared by `bun:sqlite` and `better-sqlite3`), `Profile` and
//     `CreateProfileInput` types, and the `ProfileStore` class with
//     `migrate` / `create` / `getById` / `getByName` / `list` /
//     `setDefaultAgent` / `delete`
//   - resolver: `ProfilePath` (discriminated union over `'profile'` and
//     `'project-local'`), `ProfileResolverFs` interface, `defaultResolverFs`
//     (real `node:fs/promises` wrappers), and the `ProfileResolver` class
//     with `resolve` / `resolveDefault` / `resolveForProject`
//
// The migration files live alongside (`./migrations/`) but are
// intentionally NOT re-exported here — they are runtime data consumed
// by `ProfileStore.migrate()` via the relative import inside `store.ts`.
// This matches the precedent set by `src/memory/index.ts` L11-12.

export * from './errors.js';
export * from './resolver.js';
export * from './schema.sql.js';
export * from './store.js';
