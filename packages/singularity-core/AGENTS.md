# singularity-core

Edge package on top of the OpenCode fork. Phase 20 adds **MultiAgentOrchestrator** for concurrent subagent execution with fail-fast support. Phase 9.1 adds **EventHub** for real-time event emission. Phase 6.2 adds the **subagent contract subsystem** — typed `SubagentTaskContract`, `SubagentTaskResult`, provider-neutral model/work-isolation/result-schema shapes, `SubagentContractError`, and validation/normalization helpers. Phase 5.1 adds the **workspace subsystem** — `WorktreeRunner`. Phase 6.1 adds the **profile subsystem** — `ProfileStore`, `ProfileResolver`. Phase 2.3 adds the **memory subsystem** — `FactStore`, `SessionStore`, FTS5 search. `SINGULARITY_VERSION` is now pinned to `0.1.0-phase-20`.

## What this package does (Phase 20)

- Exports `SINGULARITY_VERSION` / `SINGULARITY_PHASE` from `src/version.ts`
- Re-exports the full public surface from `src/index.ts` (memory + skills + approvals + workspace + profiles + subagents + events)
- Compiles cleanly under `bun run typecheck`
- Runs its test suite under `bun test` (in-process; uses `bun:sqlite` for fixtures)

## Memory subsystem

The memory subsystem lives in `src/memory/`:

- `src/memory/facts.ts` — `FactStore`: SQLite-backed, append-only fact memory with `create`, `supersede`, `recall`, `history`, and `getById`. Validates `confidence ∈ [0.0, 1.0]` and enforces the high-confidence source-quote requirement (`>= 0.7` needs a non-empty `source_quote`).
- `src/memory/facts.sql.ts` — the `CREATE TABLE facts (...)` schema (mirrors nlm-memory's `migrations/004_facts.sql` with two documented divergences: soft `source_session_id` / `superseded_by` references, no `fact_embeddings` vec0 table).
- `src/memory/migrations/` — ordered migration scripts (`001_initial_facts.sql.ts` and `002_fact_history_view.sql.ts`, plus the `index.ts` barrel).
- `src/memory/mcp-recall-facts.ts` — typed client for the nlm-memory `recall_facts` MCP tool. Pure builders (`buildRecallFactsInput`) plus the transport-bound `recallFacts`. The `installScope` is recorded on the profile but NOT encoded into the wire input (Phase 2.0 follow-up #1 — applied by a later wrapping phase).
- `src/memory/facts.test.ts` — `FactStore` unit tests (5 scenarios, 1:1 with the public methods).
- `src/memory/mcp-recall-facts.test.ts` — `mcp-recall-facts` unit tests (builders + mock-transport integration).
- `src/bun-globals.d.ts` — ambient type declarations for `bun:test`, `bun:sqlite`, and the global `setTimeout` / `clearTimeout` used in async tests. The package deliberately does not depend on `@types/bun`; this file is the self-contained type surface.

The test fixture at `test/db.ts` produces a fresh, in-memory `bun:sqlite` + `FactStore` pair for `beforeEach` isolation.

## Sessions subsystem

The sessions subsystem lives alongside the facts subsystem in `src/memory/`:

- `src/memory/sessions.sql.ts` — the `sessions` and `session_edges` CREATE TABLE constants (mirrors nlm-memory's `migrations/000_initial_schema.sql:14-32` and `89-94`).
- `src/memory/migrations/003_sessions_and_edges.sql.ts` — adds the `sessions` and `session_edges` tables + 6 indexes.
- `src/memory/migrations/004_fact_session_fk.sql.ts` — converts `facts.source_session_id` from TEXT to `TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE` (Phase 2.1 follow-up #1).
- `src/memory/sessions.ts` — `SessionStore` class with `upsert`, `getById`, `searchDigests` (no body), `searchByRuntime`, `addEdge`, `getLineage`, `getEdges`, `markSuperseded`.
- `src/memory/mcp-recall-sessions.ts` — typed client for the nlm-memory `recall_sessions` MCP tool.
- `src/memory/mcp-get-session.ts` — typed client for the nlm-memory `get_session` MCP tool.
- `src/memory/sessions.test.ts` — 5 tests covering the 4 IMPLEMENTATION_PLAN Task 2.2 scenarios + a bonus.

### Lineage model

Sessions form a DAG via the `session_edges` table with 4 edge kinds (`supersedes`, `continues`, `branched_from`, `merged_from`). `SessionStore.getLineage(sessionId, { direction })` walks the graph; `markSuperseded` records a `supersedes` edge and flips the predecessor's `status` to `'superseded'`. The `reason` field on `markSuperseded` is accepted but dropped (Phase 2.2 limitation; a future phase adds a `supersedence_log` table per nlm-memory's `core/storage/supersedence-log.ts`).

### FK conversion (migration 004)

`facts.source_session_id` is a real foreign key to `sessions(id)`. Inserting a fact without a corresponding session row is rejected by the database. The test fixture (`test/db.ts`) provides an `insertStubSession` helper for tests that need to satisfy the FK.

## Embedding adapter

The embedding adapter subsystem lives at `src/memory/embedding-adapter.ts`:

- `EmbeddingAdapter` interface — provider-neutral; mirrors nlm-memory's `LLMClient.embed` shape (`src/ports/llm-client.ts:65-77`).
- `NoopEmbeddingAdapter` — default implementation; returns a 768-dim zero vector synchronously. The recall layer is expected to detect all-zero embeddings and route to keyword-only search.
- `LLMUnreachableError` — error class for future live implementations (Ollama, OpenAI, Anthropic) to throw on transport failure.

Per `IMPLEMENTATION_PLAN.md` line 204: this module does NOT depend on `sqlite-memory` (license review pending). It also does NOT implement any live embedder (Ollama/OpenAI/Anthropic). Per Phase 2.0 follow-up #3, the wrap-vs-author decision is deferred to a future phase.

## FTS5 keyword search

The FTS5 keyword search lives at `src/memory/fts.ts`:

- `Fts5SessionSearch` class with `isAvailable(db)` (probes for FTS5 support), `migrate(db)` (applies the FTS5 schema), and `searchDigests(options)` (returns digest-shaped rows ranked by FTS5 relevance).
- Migration `005_sessions_fts.sql.ts` creates the `sessions_fts` virtual table + 3 sync triggers (sessions_ai/au/ad), mirroring nlm-memory `migrations/000_initial_schema.sql:100-123`.

When FTS5 is available (e.g. on this `bun:sqlite` 1.3.13 runtime), `searchDigests` uses `MATCH ?` with `ORDER BY rank`. When FTS5 is not available, it falls back to a `LIKE '%query%'` query — the same path `SessionStore.searchDigests` has used since Phase 2.2.

`SessionStore.searchDigests` (Phase 2.2 LIKE path) and `Fts5SessionSearch.searchDigests` (Phase 2.3 FTS5-with-fallback path) are parallel APIs. Future callers (Phase 7 CLI, Phase 8 gateways) can pick which to use.

## Workspace subsystem

The workspace subsystem lives in `src/workspace/`:

- `src/workspace/worktree.ts` — `WorktreeRunner`, the canonical `Worker` for code tasks. Conforms to `singularity-loop`'s `Worker` type (`(state: LoopState) => Promise<ActionResult>`) via `readonly run: Worker`. Each `run(state)` call: asserts `basePath` is inside a git working tree, creates a worktree at `<basePath>/.worktrees/<branch>` via `git worktree add --force -b <branch> <path> HEAD`, runs the placeholder subprocess, captures changed files with `git diff --name-only HEAD`, and returns an `ActionResult` whose `metadata` carries `{ artifacts, worktreePath, branch, baseCommit, wallClockMs }`. The default branch name is `${slug(goal)}-iter-${state.attempt}` (slug is lowercase ASCII, non-`[a-z0-9]` collapsed to `-`, capped at 50 chars); the `preferredBranch` constructor arg overrides it. Cleanup runs fire-and-forget after the result is returned.
- `src/workspace/worktree.test.ts` — 5 unit tests, 1:1 with the IMPLEMENTATION_PLAN Task 5.1 scenarios. Each test gets a fresh temp git repo via a `createTempGitRepo()` helper in `beforeEach`; temp dirs are tracked in a module-level set and removed in `afterEach` so tests are order-independent and the FS is left clean. The 5 scenarios cover: (1) worktree creation + complete metadata, (2) branch name embedding `state.attempt`, (3) non-git shared workdir rejected with `WorktreeError` kind `not_a_git_repo`, (4) cleanup goes through `git worktree remove` / safe path and never `rm -rf`, (5) `preferredBranch` overrides the derived branch.

`WorktreeRunner` is re-exported from `src/index.ts` alongside the other subsystems.

### Cleanup policy (3-tier, never `rm -rf`)

`WorktreeRunner.run()` fires cleanup as background work after the `ActionResult` is delivered. The three tiers, in order:

1. `git worktree remove <worktreePath>` — preferred path; leaves git's bookkeeping intact.
2. `git worktree remove --force <worktreePath>` — used when tier 1 fails (e.g. uncommitted changes blocking the safe remove).
3. `mv <worktreePath> ~/.singularity/worktrees/trash/<basename>-<ISO-stamp>` — last resort; the path is moved out of the repo so subsequent operations are not blocked. The ISO stamp uses `:` and `.` replaced with `-` so the destination is filename-safe.

`rm -rf` is never used. Cleanup errors are logged to `stderr` and swallowed — a failed cleanup must not re-enter the engine's error path after the `ActionResult` has been delivered.

### Errors

`WorktreeError` is thrown only for `git worktree` operation failures, not for subprocess failures (those propagate as rejected promises from `Worker.run()`). The `kind` discriminator covers: `not_a_git_repo`, `worktree_create_failed`, `worktree_remove_failed`, `worktree_list_failed`.

### Phase 5.1 limitations

- **Placeholder subprocess only.** `runSubprocess()` currently runs `pwd && git log -1 --format=%s && git status --short` in the worktree — enough to verify isolation, not a real agent. The TODO(phase-5.2) marker in the source commits to wiring real agent dispatch (OpenCode, Codex) here.
- **No `LoopEngine` implementation.** `WorktreeRunner` conforms to the `Worker` contract imported from `singularity-loop`, but the engine that calls `run()` on each attempt lives in that sibling package and is out of scope for this phase.
- **`worktree_list_failed` kind is reserved.** It is in the `WorktreeErrorKind` union but no method on `WorktreeRunner` raises it yet; it is forward-declared for a future phase that needs `git worktree list`.

## Profile subsystem

The profile subsystem lives in `src/profiles/`:

- `src/profiles/schema.sql.ts` — the `profiles` table schema. Six fields: `id` (TEXT PRIMARY KEY, `prof_<32-hex>`), `name` (TEXT NOT NULL UNIQUE), `root_path` (TEXT NOT NULL), `default_agent_id` (nullable TEXT, no FK), `created_at` and `updated_at` (TEXT NOT NULL DEFAULT (datetime('now'))). Composed by migration 007 — no duplication of the `CREATE TABLE` body.
- `src/profiles/migrations/007_profiles.sql.ts` — adds the `profiles` table and the 3 read-path indexes (`idx_profiles_name` for resolver `resolve(name)`, `idx_profiles_default_agent` partial on `WHERE default_agent_id IS NOT NULL` for future agent resolution, `idx_profiles_created_at DESC` for time-ordered listing). All `IF NOT EXISTS` so re-running is a no-op.
- `src/profiles/migrations/index.ts` — the per-subsystem `MIGRATIONS` array (`{ version: 7, name: '007_profiles', sql: MIGRATION_007_SQL }`). Intentionally NOT re-exported from the barrel; the runner consumes it via a relative import inside `store.ts`.
- `src/profiles/errors.ts` — `ProfileNameError` (with the `ProfileNameReason` discriminator: `empty` / `too_long` / `path_traversal` / `invalid_characters`), and `ProfileNotFoundError` (options bag `{ name?, id? }` so the same class covers both resolver-side and store-side "row missing" cases). Shared module so the store and resolver throw the same classes without a circular import.
- `src/profiles/store.ts` — `ProfileStore` class. Public methods: `migrate()` (runs every `MIGRATIONS` entry in order via `db.exec`; surfaces the failing `version` + `name` in the error), `create(input)` (validates `name` BEFORE touching SQLite; generates `prof_<32-hex>` id; defaults `root_path` to `''` and `default_agent_id` to `null`), `getById(id)` / `getByName(name)` (return `Profile | null`), `list()` (`ORDER BY created_at DESC` for future `singularity profile list`), `setDefaultAgent(id, agentId)` (updates `default_agent_id` + bumps `updated_at`; throws `ProfileNotFoundError({ id })` on zero changes), `delete(id)` (throws `ProfileNotFoundError({ id })` on zero changes; no cascade). Also exports `Profile`, `CreateProfileInput`, and `ProfileStoreDatabase` (the minimum common `bun:sqlite` / `better-sqlite3` surface: `prepare` with `run` / `all` / `get` plus `exec`).
- `src/profiles/resolver.ts` — `ProfileResolver` class. Public methods: `resolve(name)` (validate name + check `<profileRoot>/<name>/state.db`; the `'default'` name auto-creates on first call via `bootstrapDefault()` — mkdir + open DB + `ProfileStore.migrate()` + ensure default row + close in `finally`; any other missing name throws `ProfileNotFoundError({ name })`), `resolveDefault()` (equivalent to `resolve('default')`), `resolveForProject(cwd)` (returns a `'project-local'` `ProfilePath` if `<cwd>/.singularity/state.db` exists; falls back to `resolveDefault()` otherwise; never creates project-local DBs). Also exports `ProfilePath` (discriminated union over `'profile'` and `'project-local'`, both with `path` / `rootPath` / `stateDbPath` / `created`), `ProfileResolverFs` (3-method interface: `access` / `mkdir` / `stat`), and `defaultResolverFs` (real `node:fs/promises` wrappers). Constructor: `(profileRoot?, options?: { fs?, projectLocalName? })` with `profileRoot` defaulting to `join(homedir(), '.singularity', 'profiles')` and `projectLocalName` defaulting to `.singularity/state.db` per `docs/ARCHITECTURE.md` line 69.
- `src/profiles/index.ts` — public barrel. Re-exports `errors.ts`, `schema.sql.ts`, `store.ts`, and `resolver.ts`. Does NOT re-export `migrations/index.ts` (runtime-internal, per the precedent set by `src/memory/index.ts` L11-12).
- `src/bun-globals.d.ts` — gained a minimal ambient `node:fs/promises.stat` declaration so `defaultResolverFs.stat: nodeStat` is type-correct. The `Stats` object returned by a real `node:fs/promises.stat` satisfies the structural shape (`{ isDirectory(): boolean; isFile(): boolean }`). No other ambient-surface changes were required for the resolver.

The profile subsystem is re-exported from `src/index.ts` alongside the other subsystems.

### Default and project-local behavior

- `resolveDefault()` (or `resolve('default')`) on a fresh profile root will mkdir the root, mkdir `<profileRoot>/default`, open the DB, run `ProfileStore.migrate()`, ensure a `default` row exists, and return `created: true`. A second call skips the bootstrap and returns `created: false`. The DB is closed in a `finally` block on the bootstrap path; the resolver never holds a DB open across method calls.
- `resolve('work')` for a named profile is read-only. If `<profileRoot>/work/state.db` exists, the resolver returns the path with `created: false`. If it does NOT exist, the resolver throws `ProfileNotFoundError({ name: 'work' })` — Phase 7 CLI `singularity profile create <name>` is the explicit creation path.
- `resolveForProject('/path')` returns a `'project-local'` `ProfilePath` only when `<cwd>/.singularity/state.db` already exists. It does NOT create project-local DBs. If the file is absent, it falls back to `resolveDefault()` (which MAY create the default profile as a side effect — the expected fallback per `docs/ARCHITECTURE.md` line 69).

### Errors

- `ProfileNameError` is thrown by both `ProfileStore.create()` and `ProfileResolver.resolve()` (and its siblings) on invalid names. The `reason` discriminator is a closed union of four values: `empty` (empty string), `too_long` (> 64 chars), `path_traversal` (`.`, `..`, `/`, or `\\`), `invalid_characters` (anything else outside the regex). The check order in both the store and the resolver is `empty` → `too_long` → `path_traversal` → `invalid_characters`; the two implementations MUST stay in sync.
- `ProfileNotFoundError` is thrown by `ProfileResolver.resolve()` for unknown names (with `{ name }`) and by `ProfileStore.setDefaultAgent()` / `delete()` for unknown ids (with `{ id }`). The options bag keeps a single class for both resolver-side and store-side "missing" cases. The `name` and `id` fields are stored as `readonly` for caller introspection; the message falls back to `<unknown>` if neither is supplied.

### Phase 6.1 limitations

- **No CLI.** `IMPLEMENTATION_PLAN.md` line 406 explicitly defers the user-facing surface. Phase 7 will add `singularity profile list`, `singularity profile create <name>`, `singularity profile delete <name>`, and `singularity profile use <name>` on top of the resolver shipped here.
- **No `agents` table / no FK.** `profiles.default_agent_id` is a plain nullable TEXT with no `REFERENCES agents(id)` clause. A hard FK now would block this schema from applying to a fresh profile DB that has no `agents` table yet. The FK target lands in a later phase.
- **No gateway bindings.** Per `docs/SPEC.md` lines 60-76, a profile carries 10 sub-concepts (config, sessions, memory, facts, skills, plugins, gateway bindings, provider credentials REFERENCES, approval policy, tool policy). Phase 6.1 ships only the identity container; the 10 sub-concepts attach in later phases.
- **No credential storage.** Per `docs/SPEC.md` line 50, "No secrets in SQLite plaintext except via explicit encrypted credential store." The `profiles` table holds REFERENCES only. No `api_key`, `access_token`, `auth_token`, `password`, `passwd`, `secret`, or `private_key` column is added in Phase 6.1. The future `provider_credentials_ref` column lands when the encrypted credential store is designed.
- **No `WorktreeRunner` rewire.** `WorktreeRunner` (Phase 5.1) takes an explicit `basePath: string`; the resolver returns a `ProfilePath`. The integration (`new WorktreeRunner(resolvedProfile.root_path)`) is a later-phase concern, wired together by the Phase 7 CLI when `singularity code --profile <name>` lands.

## Subagent contract subsystem

The subagent contract subsystem lives in `src/subagents/`:

- `src/subagents/contract.ts` — `SubagentTaskContract` with the seven Phase 6.2 source fields (`goal`, `context`, `allowedTools`, `modelPolicy`, `workIsolation`, `resultSchema`, `maxTurns`), optional profile/session/agent identifiers, and `SubagentTaskResult`.
- `src/subagents/errors.ts` — `SubagentContractError` with a stable `SubagentContractErrorReason` discriminator for bad goals, contexts, tool allowlists, model policies, work-isolation requests, result schemas, and turn limits.
- `src/subagents/validator.ts` — `normalizeSubagentTaskContract()` and `validateSubagentTaskContract()`. The normalizer fills deterministic defaults (`allowedTools: []`, empty model policy, `workIsolation: { kind: 'none' }`, `resultSchema: { kind: 'text' }`, `maxTurns: 20`) and returns cloned objects/arrays rather than mutating caller input.
- `src/subagents/index.ts` — public barrel for the contract, errors, and validator.
- `src/subagents/contract.test.ts` — contract/defaults/serializability tests.
- `src/subagents/validator.test.ts` — validation tests covering every required Phase 6.2 field.

The subsystem is a contract layer only. It does not spawn subagents, invoke models, call provider SDKs, create worktrees, open databases, add a CLI, or create a `subagents` table.

### Phase 6.2 limitations

- **No runner/spawner.** This phase defines task/result shapes and validation only. Runtime dispatch lands later.
- **No provider execution.** `modelPolicy` is provider-neutral metadata; no OpenAI, Anthropic, Ollama, or OpenCode runtime import is introduced.
- **No persistence.** There is no `subagents` table or migration in Phase 6.2.
- **No CLI/TUI/gateway.** User-facing surfaces remain Phase 7+ / Phase 8+ work.
- **No worktree integration.** `workIsolation.kind = 'worktree'` is a request shape only; `WorktreeRunner` is not rewired here.

## What this package does NOT do (yet)

- No live embedder implementations (Ollama, OpenAI, Anthropic) — interface + noop default only
- No fact_embeddings vec0 table
- No `agents` table / no FK target for `profiles.default_agent_id`
- No provider-credential storage on the `profiles` row — encrypted credential store is in singularity-dashboard

## Conventions

- No dependencies on `@opencode-ai/*` or any OpenCode internal. The package must be self-contained.
- No `bin` field until Phase 7.
- All public API changes go through `src/index.ts` re-exports.
- Test files (`*.test.ts`) live next to the module they exercise.
- Version bumps follow the convention `0.1.0-phase-N.M` until Phase 1.0.
