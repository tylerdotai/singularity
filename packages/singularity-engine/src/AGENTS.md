# singularity-engine

Agent session runner package. Phase 20 reflects **full runtime implementation** — session runner with turn execution, compaction, and persistence.
interfaces only, no runtime logic. The first implementation (`SessionRunner.run()`)
lands in a later phase.

## What this package does (Phase 20)

- Exports all type definitions from `src/types.ts`
- Exports `EngineDeps` interface from `src/interfaces.ts`
- Exports error classes (`EngineError`, `StepLimitError`, `ContextOverflowError`,
  `TurnTransitionError`) from `src/errors.ts`
- Re-exports the full public surface from `src/index.ts`
- Does NOT include any `SessionRunner` implementation in Phase 1.0 (runtime added in later phases)

## Session runner concepts

The engine drives a single agent session from start to finish. It:

1. **Executes turns** — each turn is one LLM call plus any tool executions,
   producing a `TurnResult`
2. **Manages state** — `RunState` tracks `sessionID`, `step`, `needsContinuation`,
   and `stopReason`
3. **Compacts context** — when the rolling conversation buffer approaches the
   context window, the engine summarises older messages via the memory subsystem
4. **Persists session** — uses `SessionStore` from `singularity-core` to upsert
   the session after each turn
5. **Checks approvals** — gates tool calls via `ApprovalVault` from
   `singularity-approvals`

### SessionRunner.run()

```
SessionRunner.run(
  config: SessionRunnerConfig,
  deps: EngineDeps,
  input: AsyncIterable<Activity> | Activity[],
): AsyncGenerator<TurnResult>
```

`Activity` is a discriminated union:

- `steer` — user is redirecting or correcting the agent
- `queue` — user has queued work for the agent to process next

### Stop conditions

`StopReason` covers every terminal outcome the engine recognises:

- `goal-met` — approval guard or evaluator signalled success
- `max-iterations` — hit `SessionRunnerConfig.maxSteps`
- `worker-error` — tool execution threw
- `evaluator-error` — approval guard or policy check threw
- `cancelled` — external `AbortSignal`
- `context-overflow` — compacted context still exceeds the model context window

### EngineDeps bundle

The engine requires five dependencies:

| Field | Package | Role |
|-------|---------|------|
| `llm` | `singularity-llm` | `LLMRunner` async-generator interface |
| `tools` | `singularity-tools` | `ToolRegistryInterface` + `Materialization` |
| `store` | `singularity-core` | `SessionStore` (upsert, get, lineage) |
| `approvals` | `singularity-approvals` | `ApprovalVault` (grant/deny check) |
| `factStore` | `singularity-core` | `FactStore` (recall, create, supersede) |

### Compaction

`CompactionConfig` is derived from `SessionRunnerConfig` and passed to the
memory subsystem. The engine decides when to compact based on `bufferSize`
and `contextWindow`. Summary output is stored back to the session via
`SessionStore`.

## What this package does NOT do (yet)

- No `SessionRunner.run()` implementation — skeleton only
- No tool execution logic — delegated to `singularity-tools`
- No LLM provider runtime — consumed via `LLMRunner` interface from `singularity-llm`
- No session persistence implementation — uses `SessionStore` interface
- No approval enforcement runtime — uses `ApprovalVault` interface
- No compaction implementation — skeleton types only
- No Effect imports
- No `@opencode-ai/*` imports

## Compatibility with singularity-loop

`singularity-engine` and `singularity-loop` share `StopReason` semantics.
The engine's `StopReason` is a superset of `singularity-loop`'s — engine-specific
variants (`context-overflow`, `evaluator-error`) are distinct. Both packages
define their own `StopReason` union to stay decoupled.

## Conventions

- Plain TypeScript only — no Effect, no `@opencode-ai/*` imports
- All public API changes go through `src/index.ts` re-exports
- `EngineDeps` is the only coupling point to sibling packages — the engine
  never imports implementation details from `singularity-llm`, `singularity-tools`,
  `singularity-core`, or `singularity-approvals`
- Version bumps follow the convention `0.1.0-phase-N.M` until Phase 1.0 (now at Phase 20)
- No `bin` field — the `singularity` binary lands in a later phase
