// Ambient declarations for Bun + Node globals used by singularity-mcp.
//
// Bun 1.3.x supplies most of these at runtime; this file only adds type
// info so `tsc --noEmit` does not error on `bun:sqlite`, `bun:test`,
// the global `Bun` / `process` used by the server, and `console`.
// The package deliberately does NOT depend on `@types/bun` or
// `@types/node` — this file is the self-contained, project-owned type
// surface.

declare module "bun:sqlite" {
	export interface Statement {
		run(...params: unknown[]): {
			changes: number;
			lastInsertRowid: number | bigint;
		};
		all<T = unknown>(...params: unknown[]): T[];
		get<T = unknown>(...params: unknown[]): T | undefined;
		values<T = unknown>(...params: unknown[]): T[][];
	}

	export class Database {
		constructor(path: string);
		prepare(sql: string): Statement;
		exec(sql: string): void;
		query<T = unknown>(
			sql: string,
		): {
			all(...params: unknown[]): T[];
			get(...params: unknown[]): T | undefined;
		};
		close(): void;
	}
}

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

	export interface RejectsMatcher {
		toThrow(pattern?: RegExp | string | Error): Promise<void>;
	}

	export interface NotMatcher {
		toBe(expected: unknown): void;
		toEqual(expected: unknown): void;
		toBeNull(): void;
		toBeUndefined(): void;
		toBeDefined(): void;
		toBeTruthy(): void;
		toBeFalsy(): void;
		toThrow(pattern?: RegExp | string | Error): void;
	}

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
		toThrow(pattern?: RegExp | string | Error): void;
		not: NotMatcher;
		rejects: RejectsMatcher;
	}

	export function expect(value: unknown): ExpectMatcher;
	export function expect<T>(value: PromiseLike<T>): ExpectMatcher;
}

// Bun global namespace
declare namespace Bun {
	interface Stdin {
		text(): Promise<string>;
		stream(): ReadableStream<Uint8Array>;
	}

	interface Stdout {
		write(chunk: string | Uint8Array): boolean;
	}

	const stdin: Stdin;
	const stdout: Stdout;
}

// Node `process` global
declare let process: {
	stderr: {
		write(chunk: string): boolean;
	};
	stdin: {
		isTTY?: boolean;
	};
	cwd(): string;
	exit(code?: number): never;
	env: Record<string, string | undefined>;
};

// Console global (for logging to stderr)
declare let console: {
	error(...args: unknown[]): void;
	log(...args: unknown[]): void;
	warn(...args: unknown[]): void;
	info(...args: unknown[]): void;
};

// Global stdout (Bun provides this)
declare let stdout: {
	write(chunk: string | Uint8Array): boolean;
};
