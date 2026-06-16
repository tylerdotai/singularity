// Phase 2.3 — memory subsystem barrel (facts + sessions + embedding adapter + FTS5).
//
// Public surface of `singularity-core/memory`:
//   - facts schema + FactStore (SQLite-backed, append-only with supersedence)
//   - mcp-recall-facts: typed client for the nlm-memory `recall_facts` MCP tool
//   - sessions schema + SessionStore (lineage DAG, digest search, MCP recall/get)
//   - embedding-adapter: provider-neutral `EmbeddingAdapter` interface + `NoopEmbeddingAdapter` default + `LLMUnreachableError` (Phase 2.3)
//   - fts: FTS5 session digest search with LIKE fallback (`Fts5SessionSearch`, Phase 2.3)
//
// The migration files live alongside (`./migrations/`) but are intentionally
// NOT re-exported here — they are runtime data consumed by `FactStore.migrate()`
// via the relative import inside `facts.ts`.

export * from './embedding-adapter.js';
export * from './facts.js';
export * from './fts.js';
export * from './mcp-get-session.js';
export * from './mcp-recall-facts.js';
export * from './mcp-recall-sessions.js';
export * from './sessions.js';
