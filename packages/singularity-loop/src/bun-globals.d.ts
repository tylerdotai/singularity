// Package-level bun:test module + Bun namespace declaration.
// Global types (AbortSignal, Bun) are also declared at the workspace root (bun-globals.d.ts).
// Keeping local copies ensures singularity-loop's typecheck works standalone.

declare module "bun:test" {
	export function describe(name: string, fn: () => void | Promise<void>): void;
	export function test(
		name: string,
		fn: () => void | Promise<void>,
		timeout?: number,
	): void;
	export function it(
		name: string,
		fn: () => void | Promise<void>,
		timeout?: number,
	): void;
	export function beforeEach(fn: () => void | Promise<void>): void;
	export function afterEach(fn: () => void | Promise<void>): void;
	export function beforeAll(fn: () => void | Promise<void>): void;
	export function afterAll(fn: () => void | Promise<void>): void;
	export interface ExpectMatcher {
		toBe(expected: unknown): void;
		toEqual(expected: unknown): void;
		toBeNull(): void;
		toBeUndefined(): void;
		toBeDefined(): void;
		toBeTruthy(): void;
		toBeFalsy(): void;
		toBeInstanceOf(cls: unknown): void;
		toBeGreaterThan(value: number): void;
		toBeGreaterThanOrEqual(value: number): void;
		toBeLessThan(value: number): void;
		toBeLessThanOrEqual(value: number): void;
		toHaveLength(value: number): void;
		toContain(value: unknown): void;
		toMatch(pattern: RegExp | string): void;
		toThrow(
			pattern?: RegExp | string | Error | { new (message: string): Error },
		): void;
		not: {
			toBe(expected: unknown): void;
			toEqual(expected: unknown): void;
			toBeNull(): void;
			toThrow(
				pattern?: RegExp | string | Error | { new (message: string): Error },
			): void;
		};
		rejects: {
			toThrow(
				pattern?: RegExp | string | Error | { new (message: string): Error },
			): Promise<void>;
		};
	}
	export function expect(value: unknown): ExpectMatcher;
	export function expect<T>(value: PromiseLike<T>): ExpectMatcher;
}

declare namespace Bun {
	interface SpawnOptions {
		cmd: readonly string[];
		cwd?: string;
		stdout?: "pipe" | "inherit" | "ignore";
		stderr?: "pipe" | "inherit" | "ignore";
		env?: Record<string, string>;
		signal?: AbortSignal;
	}
	interface Subprocess {
		readonly stdout: ReadableStream<Uint8Array> | undefined;
		readonly stderr: ReadableStream<Uint8Array> | undefined;
		readonly exited: Promise<number>;
		kill(): void;
	}
	function spawn(options: SpawnOptions): Subprocess;
}

declare let process: {
	cwd(): string;
};
