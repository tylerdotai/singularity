import type {
	ActionResult,
	Evaluator,
	HistoryEntry,
	LoopReport,
	LoopSpec,
	LoopState,
	StopReason,
	Worker,
} from "./types.js";

export class LoopValidationError extends Error {
	readonly name = "LoopValidationError";
	constructor(message: string) {
		super(message);
	}
}

function validateSpec(spec: LoopSpec): void {
	if (typeof spec.goal !== "string" || spec.goal.trim().length === 0) {
		throw new LoopValidationError("LoopSpec.goal must be a non-empty string");
	}
	if (!Number.isInteger(spec.maxIterations) || spec.maxIterations < 1) {
		throw new LoopValidationError(
			`LoopSpec.maxIterations must be an integer >= 1, got ${spec.maxIterations}`,
		);
	}
	if (spec.context === null || typeof spec.context !== "object") {
		throw new LoopValidationError("LoopSpec.context must be a non-null object");
	}
}

function buildState(
	spec: LoopSpec,
	attempt: number,
	previousFeedback: string,
	history: readonly HistoryEntry[],
): LoopState {
	return Object.freeze({
		goal: spec.goal,
		attempt,
		maxIterations: spec.maxIterations,
		context: spec.context,
		previousFeedback,
		history,
	});
}

export async function runLoop(
	spec: LoopSpec,
	worker: Worker,
	evaluator: Evaluator,
	signal?: AbortSignal,
): Promise<LoopReport> {
	validateSpec(spec);

	const history: HistoryEntry[] = [];
	let previousFeedback = "";
	let stopReason: StopReason = "max_iterations";

	for (let attempt = 1; attempt <= spec.maxIterations; attempt++) {
		if (signal?.aborted) {
			stopReason = "aborted";
			break;
		}

		const state = buildState(
			spec,
			attempt,
			previousFeedback,
			Object.freeze([...history]),
		);

		let result: ActionResult;
		try {
			result = await worker(state);
		} catch (err) {
			stopReason = "max_iterations";
			history.push(
				Object.freeze({
					attempt,
					output: err instanceof Error ? err.message : String(err),
					passed: false,
					evalMessage: "worker threw",
					metadata: {},
				}),
			);
			break;
		}

		let passed: boolean;
		let evalMessage: string;
		try {
			const verdict = await evaluator(result, state);
			if (
				typeof verdict !== "object" ||
				verdict === null ||
				!Array.isArray(verdict) ||
				verdict.length !== 2
			) {
				throw new Error(
					`Evaluator must return [boolean, string], got ${typeof verdict}`,
				);
			}
			passed = verdict[0];
			evalMessage = verdict[1];
			if (typeof passed !== "boolean") {
				throw new Error(
					`Evaluator passed must be strict boolean, got ${typeof passed}`,
				);
			}
		} catch (err) {
			stopReason = "max_iterations";
			history.push(
				Object.freeze({
					attempt,
					output: result.output,
					passed: false,
					evalMessage: `evaluator threw: ${err instanceof Error ? err.message : String(err)}`,
					metadata: result.metadata,
				}),
			);
			break;
		}

		history.push(
			Object.freeze({
				attempt,
				output: result.output,
				passed,
				evalMessage,
				metadata: result.metadata,
			}),
		);

		if (passed) {
			stopReason = "eval_passed";
			break;
		}

		previousFeedback = evalMessage;
	}

	if (stopReason !== "eval_passed" && stopReason !== "aborted") {
		stopReason = "max_iterations";
	}

	return Object.freeze({
		goal: spec.goal,
		success: stopReason === "eval_passed",
		iterations: history.length,
		stopReason,
		history: Object.freeze([...history]),
	});
}
