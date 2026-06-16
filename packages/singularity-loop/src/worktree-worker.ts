// Uses Bun.spawn for cross-environment subprocess execution.
// Bun.spawn is declared in bun-globals.d.ts; no node:child_process import needed.
import type { ActionResult, LoopState, Worker } from "./types.js";

export interface WorktreeWorkerOptions {
	command: string;
	args?: string[];
	worktreeRoot?: string;
	env?: Record<string, string>;
}

function hashString(s: string): string {
	let h = 5381;
	for (let i = 0; i < s.length; i++) {
		h = ((h << 5) + h) ^ s.charCodeAt(i);
		h = h >>> 0;
	}
	return h.toString(16).padStart(8, "0");
}

function buildArgs(opts: WorktreeWorkerOptions, state: LoopState): string[] {
	const base = opts.args ?? [];
	const goalArg = state.previousFeedback
		? [state.goal, `--feedback=${state.previousFeedback}`]
		: [state.goal];
	return [...goalArg, ...base];
}

async function runCommand(
	cmd: string,
	args: string[],
	cwd: string,
	env: Record<string, string>,
	signal?: AbortSignal,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
	const proc = Bun.spawn({
		cmd: [cmd, ...args],
		cwd,
		env: env,
		stdout: "pipe",
		stderr: "pipe",
		signal,
	} as any);

	const stdout = await new Response(proc.stdout).text();
	const stderr = await new Response(proc.stderr).text();
	const exitCode = await proc.exited;

	return { stdout, stderr, exitCode };
}

export function createWorktreeWorker(opts: WorktreeWorkerOptions): Worker {
	if (!opts.command) throw new Error("createWorktreeWorker requires a command");
	return async (
		state: LoopState,
		signal?: AbortSignal,
	): Promise<ActionResult> => {
		const worktreeRoot =
			opts.worktreeRoot ?? `/tmp/singularity-loop-${hashString(state.goal)}`;
		const args = buildArgs(opts, state);
		const start = Date.now();
		const { stdout, stderr, exitCode } = await runCommand(
			opts.command,
			args,
			worktreeRoot,
			opts.env ?? {},
			signal,
		);
		const wallClockMs = Date.now() - start;
		const output =
			exitCode === 0
				? stdout.trim()
				: `${stdout.trim()}\n[exit ${exitCode}]${stderr ? ` ${stderr.trim()}` : ""}`;
		return {
			output,
			metadata: Object.freeze({
				command: opts.command,
				args,
				worktreeRoot,
				exitCode,
				wallClockMs,
				stdoutLength: stdout.length,
				stderrLength: stderr.length,
			}),
		};
	};
}
