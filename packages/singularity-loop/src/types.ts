/**
 * TypeScript type port of `agent-loop-system/src/agent_loop/engine.py`.
 *
 * These interfaces describe the contract between the loop engine and its
 * pluggable worker/evaluator functions. All fields are `readonly` — the
 * loop engine never mutates state in place; it produces new objects each
 * iteration and hands them to the worker/evaluator.
 *
 * The "feedback loop" the engine is built around is `previousFeedback`:
 * the evaluator's message from attempt N becomes the worker context on
 * attempt N+1.
 */

/**
 * The specification for a closed loop run.
 *
 * The caller provides:
 * - `goal`: what the loop is trying to achieve (the evaluator judges
 *   whether the worker's output achieves this).
 * - `maxIterations`: hard cap on attempts before the loop gives up.
 * - `context`: opaque pass-through state (e.g., worktree path, profile,
 *   config) available to worker/evaluator each iteration.
 */
export interface LoopSpec {
	/** What the loop is trying to achieve. Evaluator judges worker output against this. */
	readonly goal: string;
	/** Hard cap on attempts before the loop gives up. Validated to be >= 1 by the engine. */
	readonly maxIterations: number;
	/** Opaque pass-through state (worktree path, profile, config) available to worker/evaluator each iteration. */
	readonly context: Readonly<Record<string, unknown>>;
}

/**
 * The worker's output for one iteration.
 *
 * - `output`: human-readable text (the evaluator reads this to judge pass/fail).
 * - `metadata`: machine-readable extras (timing, artifacts, etc.).
 */
export interface ActionResult {
	/** Human-readable text. The evaluator reads this to judge pass/fail. */
	readonly output: string;
	/** Machine-readable extras (timing, artifacts, structured signals). */
	readonly metadata: Readonly<Record<string, unknown>>;
}

/**
 * One row in the loop's history — what the worker produced, what the
 * evaluator decided, and the evaluator's message.
 *
 * The evaluator's message becomes the next iteration's `previousFeedback`
 * — this is the feedback loop.
 */
export interface HistoryEntry {
	/** 1-indexed attempt number this entry corresponds to. */
	readonly attempt: number;
	/** The worker's `ActionResult.output` for this attempt. */
	readonly output: string;
	/** Whether the evaluator judged this attempt a pass. */
	readonly passed: boolean;
	/** The evaluator's message. Fed back as `previousFeedback` on the next iteration. */
	readonly evalMessage: string;
	/** The worker's `ActionResult.metadata` for this attempt. */
	readonly metadata: Readonly<Record<string, unknown>>;
}

/**
 * The final report — what the loop produced, whether it succeeded,
 * how many iterations it took, and why it stopped.
 */
export interface LoopReport {
	/** The original `LoopSpec.goal` (echoed for caller convenience). */
	readonly goal: string;
	/** Whether the loop ended with the evaluator returning `passed=true`. */
	readonly success: boolean;
	/** Total iterations the loop ran (1..=maxIterations). */
	readonly iterations: number;
	/** Why the loop stopped. See `StopReason`. */
	readonly stopReason: StopReason;
	/** Full history of attempts the loop went through. */
	readonly history: readonly HistoryEntry[];
}

/**
 * The state object passed to the worker and evaluator each iteration.
 *
 * - `goal`: same as `LoopSpec.goal` (denormalized for worker convenience).
 * - `attempt`: 1-indexed attempt number.
 * - `maxIterations`: same as `LoopSpec.maxIterations` (denormalized).
 * - `context`: same as `LoopSpec.context` (pass-through).
 * - `previousFeedback`: the previous evaluator's message. **This is the
 *   feedback loop** — on attempt 2+, the worker sees what failed before
 *   and can adjust.
 * - `history`: all prior attempts' entries (so the worker can self-correct
 *   based on full history, not just the last failure).
 */
export interface LoopState {
	/** The loop's goal, denormalized from `LoopSpec.goal` for worker convenience. */
	readonly goal: string;
	/** 1-indexed attempt number (1 on the first iteration, 2 on the second, ...). */
	readonly attempt: number;
	/** The max iteration cap, denormalized from `LoopSpec.maxIterations`. */
	readonly maxIterations: number;
	/** Opaque pass-through from `LoopSpec.context`. */
	readonly context: Readonly<Record<string, unknown>>;
	/** The previous evaluator's message. **The feedback loop.** Empty string on attempt 1. */
	readonly previousFeedback: string;
	/** All prior attempts. Empty on attempt 1. */
	readonly history: readonly HistoryEntry[];
}

/**
 * The worker function — the "do one attempt" side of the loop.
 *
 * Receives the full `LoopState` (goal, attempt, history, feedback).
 * Returns an `ActionResult` (output + metadata).
 *
 * In Phase 5.1, the worker will be a `WorktreeRunner` that executes
 * a subprocess in an isolated worktree. In later phases, it may
 * emit NLM signals via an observer hook.
 */
export type Worker = (state: LoopState) => Promise<ActionResult>;

/**
 * The evaluator function — the "judge the attempt" side of the loop.
 *
 * Receives the worker's `ActionResult` and the `LoopState` (so the
 * evaluator can read `goal`, `context`, `history`).
 *
 * Returns a tuple:
 * - `[0]`: `passed` (strict boolean — see "Strict Evaluator Gate" below).
 * - `[1]`: `message` (string — fed back as `previousFeedback` next iter).
 *
 * **Strict Evaluator Gate:** `passed` MUST be a JSON boolean (`true` or
 * `false`). Truthy strings, non-zero numbers, etc. are NOT accepted.
 * This is enforced in the engine (designed, not implemented in Phase 5.0).
 */
export type Evaluator = (
	result: ActionResult,
	state: LoopState,
) => Promise<readonly [passed: boolean, message: string]>;

/**
 * Why the loop stopped.
 *
 * Source has only 2 reasons. Production needs at least 6 — see
 * `docs/singularity/LOOP.md` §5 (Stop Condition Design) for the
 * full set and the rationale for the extension.
 */
export type StopReason =
	| "eval_passed" // source: evaluator returned passed=true
	| "max_iterations" // source: exhausted without a pass
	// Designed for future phases (NOT implemented in Phase 5.0):
	| "time_budget_exceeded"
	| "cost_budget_exceeded"
	| "consecutive_failures"
	| "no_progress"
	| "aborted"; // user/system cancellation
