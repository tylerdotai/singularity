/**
 * Phase 5.1 — runtime loop engine, worktree worker, and default evaluator.
 * See `docs/singularity/LOOP.md` for the architecture decision record.
 */

export {
	createDefaultEvaluator,
	type DefaultEvaluatorOptions,
} from "./default-evaluator.js";
export { LoopValidationError, runLoop } from "./engine.js";
export * from "./types.js";
export {
	createWorktreeWorker,
	type WorktreeWorkerOptions,
} from "./worktree-worker.js";
