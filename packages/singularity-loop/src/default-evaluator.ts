import type { ActionResult, Evaluator, LoopState } from "./types.js";

export interface DefaultEvaluatorOptions {
	/** Exit code that counts as success. Defaults to 0. */
	successExitCode?: number;
	/** If set, pass when output matches this regex. */
	passPattern?: RegExp;
	/** If set, fail when output matches this regex (even if passPattern also matches). */
	failPattern?: RegExp;
	/** Custom judge function. Takes output + metadata, returns pass message or null to use defaults. */
	judge?: (
		output: string,
		metadata: Readonly<Record<string, unknown>>,
	) => string | null;
}

function applyRules(
	output: string,
	metadata: Readonly<Record<string, unknown>>,
	opts: DefaultEvaluatorOptions,
): string | null {
	if (opts.judge) {
		const msg = opts.judge(output, metadata);
		if (msg !== null) return msg;
	}
	const exitCode = (metadata.exitCode as number) ?? 0;
	const expectedCode = opts.successExitCode ?? 0;
	if (exitCode !== expectedCode) {
		return `exit code ${exitCode} != ${expectedCode}`;
	}
	if (opts.failPattern && opts.failPattern.test(output)) {
		return `output matched fail pattern ${opts.failPattern}`;
	}
	if (opts.passPattern && !opts.passPattern.test(output)) {
		return `output did not match pass pattern ${opts.passPattern}`;
	}
	return null;
}

export function createDefaultEvaluator(
	opts: DefaultEvaluatorOptions = {},
): Evaluator {
	return async (
		result: ActionResult,
		_state: LoopState,
	): Promise<readonly [boolean, string]> => {
		const reason = applyRules(result.output, result.metadata, opts);
		if (reason === null) {
			return [true, "all checks passed"] as const;
		}
		return [false, reason] as const;
	};
}
