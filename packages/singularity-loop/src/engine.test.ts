import { describe, expect, test } from "bun:test";
import { LoopValidationError, runLoop } from "./engine.js";
import type {
	ActionResult,
	Evaluator,
	LoopSpec,
	StopReason,
	Worker,
} from "./types.js";

function makeSpec(overrides: Partial<LoopSpec> = {}): LoopSpec {
	return {
		goal: "test goal",
		maxIterations: 3,
		context: {},
		...overrides,
	};
}

function countingWorker(counter: { calls: number }) {
	return async (state: { attempt: number }): Promise<ActionResult> => {
		counter.calls++;
		return {
			output: `attempt ${state.attempt}`,
			metadata: { attempt: state.attempt },
		};
	};
}

describe("runLoop validation", () => {
	test("throws LoopValidationError for empty goal", () => {
		const spec = makeSpec({ goal: "" });
		const worker: Worker = async () => ({ output: "x", metadata: {} });
		const eval_: Evaluator = async () => [true, "ok"];
		expect(() => runLoop(spec, worker, eval_)).toThrow(LoopValidationError);
	});

	test("throws LoopValidationError for whitespace-only goal", () => {
		const spec = makeSpec({ goal: "   " });
		const worker: Worker = async () => ({ output: "x", metadata: {} });
		const eval_: Evaluator = async () => [true, "ok"];
		expect(() => runLoop(spec, worker, eval_)).toThrow(LoopValidationError);
	});

	test("throws LoopValidationError for maxIterations < 1", () => {
		const spec = makeSpec({ maxIterations: 0 });
		const worker: Worker = async () => ({ output: "x", metadata: {} });
		const eval_: Evaluator = async () => [true, "ok"];
		expect(() => runLoop(spec, worker, eval_)).toThrow(LoopValidationError);
	});

	test("throws LoopValidationError for negative maxIterations", () => {
		const spec = makeSpec({ maxIterations: -1 });
		const worker: Worker = async () => ({ output: "x", metadata: {} });
		const eval_: Evaluator = async () => [true, "ok"];
		expect(() => runLoop(spec, worker, eval_)).toThrow(LoopValidationError);
	});
});

describe("runLoop iteration", () => {
	test("succeeds on first eval pass", async () => {
		const spec = makeSpec({ maxIterations: 3 });
		const counter = { calls: 0 };
		const worker = countingWorker(counter);
		const eval_: Evaluator = async () => [true, "perfect"] as const;
		const report = await runLoop(spec, worker, eval_);
		expect(report.success).toBe(true);
		expect(report.stopReason).toBe("eval_passed");
		expect(report.iterations).toBe(1);
		expect(report.history.length).toBe(1);
		expect(report.history[0].passed).toBe(true);
		expect(report.history[0].evalMessage).toBe("perfect");
		expect(counter.calls).toBe(1);
	});

	test("runs multiple iterations until eval passes", async () => {
		const spec = makeSpec({ maxIterations: 3 });
		let attempt = 0;
		const worker: Worker = async (s) => {
			attempt++;
			return { output: `attempt ${s.attempt}`, metadata: {} };
		};
		const eval_: Evaluator = async (r) => {
			if (r.output.includes("attempt 3")) return [true, "there it is"] as const;
			return [false, `not there yet, got ${r.output}`] as const;
		};
		const report = await runLoop(spec, worker, eval_);
		expect(report.success).toBe(true);
		expect(report.iterations).toBe(3);
		expect(report.history[0].passed).toBe(false);
		expect(report.history[1].passed).toBe(false);
		expect(report.history[2].passed).toBe(true);
	});

	test("stops at maxIterations without pass", async () => {
		const spec = makeSpec({ maxIterations: 2 });
		const worker: Worker = async (s) => ({
			output: `attempt ${s.attempt}`,
			metadata: {},
		});
		const eval_: Evaluator = async () => [false, "not good"] as const;
		const report = await runLoop(spec, worker, eval_);
		expect(report.success).toBe(false);
		expect(report.stopReason).toBe("max_iterations");
		expect(report.iterations).toBe(2);
		expect(report.history.every((h) => !h.passed)).toBe(true);
	});

	test("worker throw ends loop with max_iterations", async () => {
		const spec = makeSpec({ maxIterations: 3 });
		const worker: Worker = async () => {
			throw new Error("boom");
		};
		const eval_: Evaluator = async () => [false, "worker failed"] as const;
		const report = await runLoop(spec, worker, eval_);
		expect(report.success).toBe(false);
		expect(report.stopReason).toBe("max_iterations");
		expect(report.iterations).toBe(1);
		expect(report.history[0].output).toBe("boom");
		expect(report.history[0].passed).toBe(false);
	});

	test("evaluator throw ends loop with max_iterations", async () => {
		const spec = makeSpec({ maxIterations: 3 });
		const worker: Worker = async () => ({ output: "ok", metadata: {} });
		const eval_: Evaluator = async () => {
			throw new Error("eval broken");
		};
		const report = await runLoop(spec, worker, eval_);
		expect(report.success).toBe(false);
		expect(report.stopReason).toBe("max_iterations");
		expect(report.history[0].evalMessage).toContain("eval broken");
	});

	test("strict boolean required from evaluator", async () => {
		const spec = makeSpec({ maxIterations: 1 });
		const worker: Worker = async () => ({ output: "x", metadata: {} });
		const eval_: Evaluator = async () => [
			"yes" as any,
			"truthy string rejected",
		];
		const report = await runLoop(spec, worker, eval_);
		expect(report.stopReason).toBe("max_iterations");
		expect(report.history[0].evalMessage).toContain("strict boolean");
	});

	test("previousFeedback is empty on first attempt", async () => {
		const spec = makeSpec({ maxIterations: 1 });
		const seenFeedback: string[] = [];
		const worker: Worker = async (s) => {
			seenFeedback.push(s.previousFeedback);
			return { output: "done", metadata: {} };
		};
		const eval_: Evaluator = async () => [true, "ok"] as const;
		await runLoop(spec, worker, eval_);
		expect(seenFeedback[0]).toBe("");
	});

	test("previousFeedback carries eval message to next iteration", async () => {
		const spec = makeSpec({ maxIterations: 2 });
		const seenFeedback: string[] = [];
		const worker: Worker = async (s) => {
			seenFeedback.push(s.previousFeedback);
			return { output: `attempt ${s.attempt}`, metadata: {} };
		};
		const eval_: Evaluator = async (r) => {
			if (r.output.includes("attempt 2")) return [true, "done"] as const;
			return [false, `fix: got ${r.output}`] as const;
		};
		await runLoop(spec, worker, eval_);
		expect(seenFeedback[0]).toBe("");
		expect(seenFeedback[1]).toBe("fix: got attempt 1");
	});

	test("history is append-only (not mutated)", async () => {
		const spec = makeSpec({ maxIterations: 3 });
		const worker: Worker = async (s) => ({
			output: `a${s.attempt}`,
			metadata: {},
		});
		const eval_: Evaluator = async () => [false, "nope"] as const;
		const report = await runLoop(spec, worker, eval_);
		const hist = report.history;
		expect(() => (hist as any).push({} as any)).toThrow();
	});

	test("report fields are correct", async () => {
		const spec = makeSpec({ goal: "my goal", maxIterations: 1 });
		const worker: Worker = async () => ({ output: "x", metadata: { k: "v" } });
		const eval_: Evaluator = async () => [true, "ok"] as const;
		const report = await runLoop(spec, worker, eval_);
		expect(report.goal).toBe("my goal");
		expect(report.success).toBe(true);
		expect(report.iterations).toBe(1);
		expect(report.stopReason).toBe("eval_passed");
		expect(report.history[0].metadata.k).toBe("v");
	});
});

describe("runLoop abort", () => {
	test("stops with aborted when signal already aborted", async () => {
		const spec = makeSpec({ maxIterations: 3 });
		const controller = new AbortController();
		controller.abort();
		const worker: Worker = async (s) => ({
			output: `a${s.attempt}`,
			metadata: {},
		});
		const eval_: Evaluator = async () => [false, "no"] as const;
		const report = await runLoop(spec, worker, eval_, controller.signal);
		expect(report.stopReason).toBe("aborted");
		expect(report.iterations).toBe(0);
	});

	test("stops with aborted mid-iteration", async () => {
		const spec = makeSpec({ maxIterations: 3 });
		const controller = new AbortController();
		const worker: Worker = async (s) => {
			if (s.attempt === 2) controller.abort();
			return { output: `a${s.attempt}`, metadata: {} };
		};
		const eval_: Evaluator = async () => [false, "no"] as const;
		const report = await runLoop(spec, worker, eval_, controller.signal);
		expect(report.stopReason).toBe("aborted");
		expect(report.iterations).toBe(2);
	});
});
