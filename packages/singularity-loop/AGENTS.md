# singularity-loop

Edge package that hosts the **closed-loop quality gate engine**. Phase 20 reflects **full runtime implementation** — the loop engine drives iterative refinement: dispatch a worktree-bound action, evaluate the result, decide whether to stop, and emit a structured report. Every refinement cycle is a single iteration of the loop.

The package includes runtime loop driver, worktree runner, and observability. See `docs/singularity/APPROVALS.md` for the architecture decision record.

## What this package does (Phase 20)

- Exports `LoopSpec`, `ActionResult`, `HistoryEntry`, `LoopReport`,
  `LoopState`, and `StopReason` from `src/types.ts`
- Exports the `Worker` and `Evaluator` interfaces from `src/types.ts`
- Re-exports the full public surface from `src/index.ts`
- Does NOT include any runtime loop driver in Phase 5.0 (spike)
- Does NOT include any tests in Phase 5.0 (spike)

## Loop engine concepts

The loop engine is a closed-loop quality gate. It repeatedly runs a
`Worker` against a `LoopSpec`, hands the result to an `Evaluator`, and
stops when the evaluator signals a terminal condition. Each iteration
appends a `HistoryEntry` so the full refinement path is reconstructable
after the fact. The driver is deliberately small — most policy lives in
the injected `Worker` and `Evaluator`, not in the loop itself.

### Inputs

`src/types.ts` defines the inputs:

- `LoopSpec` — the loop configuration: `id`, `goal`, `maxIterations`,
  optional `seed` (initial worker input), optional `context` (read-only
  facts the worker can reference), and the `StopReason` set the loop
  recognizes
- `LoopState` — the mutable per-iteration state: `iteration` counter,
  `lastResult`, `lastEvaluation`, `history` (append-only), and the
  current `StopReason | null`

### Iteration

Each iteration produces two artifacts:

- `ActionResult` — what the worker produced: `iteration`, `specId`,
  `output` (opaque worker payload), optional `artifacts` (file paths,
  diff hunks, command logs), and a `wallClockMs` measurement
- `HistoryEntry` — a frozen `(ActionResult, Evaluation)` pair with a
  monotonic `recordedAt` timestamp; `history` is append-only and never
  mutated in place

### Stop conditions

`StopReason` is a discriminated union covering every terminal outcome
the loop recognizes in Phase 5.0:

- `'goal-met'` — the evaluator judged the work complete
- `'max-iterations'` — the loop hit `LoopSpec.maxIterations` without
  converging
- `'worker-error'` — the worker threw or returned a fatal `ActionResult`
- `'evaluator-error'` — the evaluator itself failed
- `'cancelled'` — an external signal interrupted the loop

Additional stop conditions (`'budget-exhausted'`, `'no-progress'`,
`'regressed'`) land in a later phase once the worktree runner has
produced real telemetry.

### Worker + evaluator

Both are interfaces, not implementations:

- `Worker` — `run(spec, state, signal): Promise<ActionResult>`. The
  worker is opaque: it may run a CLI, edit files in a worktree, or call
  a remote agent. The loop does not interpret the output.
- `Evaluator` — `evaluate(result, spec, state, signal): Promise<Evaluation>`.
  The evaluator returns a verdict (`'continue' | 'stop'`) plus the
  reasoning, optional score, and the next `StopReason` candidate.

The `signal` parameter is an `AbortSignal` so either step can be
cancelled externally; the loop checks it between iterations.

### Report

When the loop terminates, it emits a `LoopReport`:

- `LoopReport` — `specId`, `stopReason`, the final `LoopState`, the
  full `history`, and aggregate timings (`startedAt`, `endedAt`,
  `totalIterations`, `totalWallClockMs`)

Phase 5.0 only writes the report to a return value. Phase 5.3 persists
`LoopReport` rows to the `loop_runs` table in `state.db` so historical
loops are queryable alongside sessions and facts.

## Phase 5.1 — worktree runner

Phase 5.1 is the first runtime. It introduces:

- `WorktreeWorker` — implements `Worker` by dispatching a child process
  inside an isolated git worktree (one worktree per `LoopSpec.id`)
- The worktree path is derived from `LoopSpec.id` and registered with
  the existing `singularity-loop worktree` command (a future CLI surface)
- `ActionResult.artifacts` is populated with the worktree path and any
  changed-file list captured post-run

The worktree runner is the canonical Worker; the `Evaluator` in 5.1
stays injected so policy remains configurable.

## Future phases

- **LoopObserver + NLM signal hooks** — emit per-iteration signals to
  the memory subsystem (`nlm-memory` MCP) so the loop's history becomes
  a queryable artifact in the same store as facts and sessions. Hook
  into `recall_sessions` for cross-loop lineage.
- **Additional stop conditions** — `'budget-exhausted'` (token / cost
  ceiling), `'no-progress'` (N consecutive iterations below a progress
  threshold), `'regressed'` (evaluator score dropped vs. previous
  iteration). Each is a new `StopReason` variant + a corresponding
  `LoopSpec` knob.
- **Evaluator composition** — chain multiple evaluators via
  `CompositeEvaluator` (AND / OR / quorum semantics). Lets one loop
  require "tests pass" AND "lint clean" AND "reviewer approved" before
  stopping on `'goal-met'`.
- **Report persistence to `state.db`** — write `LoopReport` rows to a
  new `loop_runs` table (mirroring the Phase 2.x memory tables). Expose
  via `recall_loops` MCP client. This makes the loop engine's output
  first-class memory, not a return value.

## What this package does NOT do (yet)

- No runtime loop driver (Phase 5.1)
- No worktree integration (Phase 5.1)
- No `Worker` implementation — only the interface (Phase 5.1)
- No `Evaluator` implementation — only the interface (Phase 5.1)
- No `LoopObserver` or NLM signal hooks (later phase)
- No `loop_runs` table or `state.db` persistence (later phase)
- No `CompositeEvaluator` (later phase)
- No TUI/CLI for loop management (Phase 7)
- No `bin` field — the `singularity` binary lands in Phase 7
- No tests in Phase 5.0 (spike)
- No new dependencies; the package is self-contained

## Conventions

- No dependencies on `@opencode-ai/*`, `nlm-memory`, `@modelcontextprotocol/sdk`,
  `ollama`, `openai`, or `anthropic`. The package must be self-contained.
- No `bin` field until Phase 7.
- All public API changes go through `src/index.ts` re-exports.
- Version bumps follow the convention `0.1.0-phase-N.M` until Phase 1.0.
- All types are `readonly` to keep `LoopSpec`, `ActionResult`, `HistoryEntry`,
  and `LoopReport` immutable once handed back to a caller.
- `StopReason` is a discriminated string union — never an `enum`, never a
  numeric code. New variants land via a new `0.1.0-phase-N.M` version.
- The loop engine never interprets worker output. Policy lives in
  injected `Worker` and `Evaluator` implementations, not in the driver.
