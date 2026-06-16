// Ambient declarations for Bun + Node globals used by singularity-core.
//
// Bun 1.3.x supplies most of these at runtime; this file only adds type
// info so `tsgo --noEmit` (TypeScript 7.0.0-dev) does not error on
// `bun:test`, `bun:sqlite`, the global `Bun` / `Response` / `process`
// used by the workspace subsystem, the `node:fs/promises` /
// `node:os` / `node:path` module imports, `import.meta.dir` (Bun-only),
// and the global `setTimeout` / `clearTimeout` used in async test
// bodies. The package deliberately does NOT depend on `@types/bun` or
// `@types/node` — this file is the self-contained, project-owned type
// surface for both the production and test layers.
//
// Scope: just enough to make the existing test files AND the Phase 5.1
// workspace subsystem (`src/workspace/worktree.ts` + its test) typecheck.
// Wider Bun/Node surface is out of scope; add to this file when a new
// surface is needed.
//
// Note: this file is intentionally a SCRIPT (no top-level import or
// export) so that the `declare module` blocks create ambient module
// declarations from scratch. Top-level `declare function`, `declare
// var`, `declare namespace`, and `interface ImportMeta` augmentation
// are also script-only — they become globals on the implicit global
// scope.

// Global declarations for Bun's test runner. At runtime Bun injects
// `describe`, `test`, `it`, `expect`, and the lifecycle hooks as
// globals; this block mirrors that for `tsgo --noEmit`. The module
// declarations below coexist with these globals — a file may either
// reference the names bare (global) or `import { ... } from 'bun:test'`
// (module). New test files should use the global form.
declare function describe(name: string, fn: () => void | Promise<void>): void;
declare function test(
  name: string,
  fn: () => void | Promise<void>,
  timeout?: number
): void;
declare function it(
  name: string,
  fn: () => void | Promise<void>,
  timeout?: number
): void;
declare function beforeEach(fn: () => void | Promise<void>): void;
declare function afterEach(fn: () => void | Promise<void>): void;
declare function beforeAll(fn: () => void | Promise<void>): void;
declare function afterAll(fn: () => void | Promise<void>): void;

declare interface RejectsMatcher {
  toThrow(pattern?: RegExp | string | Error): Promise<void>;
}

declare interface NotMatcher {
  toBe(expected: unknown): void;
  toEqual(expected: unknown): void;
  toBeNull(): void;
  toBeUndefined(): void;
  toBeDefined(): void;
  toBeTruthy(): void;
  toBeFalsy(): void;
  toThrow(pattern?: RegExp | string | Error): void;
}

declare interface ExpectMatcher {
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

declare function expect(value: unknown): ExpectMatcher;
declare function expect<T>(value: PromiseLike<T>): ExpectMatcher;

declare module 'bun:test' {
  // Top-level test API. Mirrors a small subset of the vitest/jest shape
  // that our tests use.
  export function describe(name: string, fn: () => void | Promise<void>): void;
  export function it(
    name: string,
    fn: () => void | Promise<void>,
    timeout?: number
  ): void;
  export function beforeEach(fn: () => void | Promise<void>): void;
  export function afterEach(fn: () => void | Promise<void>): void;
  export function beforeAll(fn: () => void | Promise<void>): void;
  export function afterAll(fn: () => void | Promise<void>): void;

  // Rejection-aware matcher. `expect(promise).rejects.toThrow(...)` is
  // async — the matcher returns a Promise. This is the only method
  // currently used by tests in this package.
  export interface RejectsMatcher {
    toThrow(pattern?: RegExp | string | Error): Promise<void>;
  }

  // The `not` chain mirrors the methods we use, just with inverted
  // semantics. Phase 2.1 tests call `.not.toThrow()` and `.not.toBeNull()`.
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

  // Positive matcher. Methods listed are exactly those invoked by
  // current test files — add to this list if a new test needs more.
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
    // `rejects` exists on the matcher object itself — it is reached
    // via `expect(promise).rejects.toThrow(...)` in async tests.
    rejects: RejectsMatcher;
  }

  // Overloads for `expect`:
  //   - `expect(value)`          — synchronous matcher chain
  //   - `expect(promise)`        — also supports `.rejects` (Promise-aware)
  export function expect(value: unknown): ExpectMatcher;
  export function expect<T>(value: PromiseLike<T>): ExpectMatcher;
}

declare module 'bun:sqlite' {
  // Minimal `Statement` surface used by FactStore.
  export interface Statement {
    run(...params: unknown[]): {
      changes: number;
      lastInsertRowid: number | bigint;
    };
    all<T = unknown>(...params: unknown[]): T[];
    get<T = unknown>(...params: unknown[]): T | undefined;
    values<T = unknown>(...params: unknown[]): T[][];
  }

  // Minimal `Database` surface used by FactStore + the test fixture.
  export class Database {
    constructor(path: string);
    prepare(sql: string): Statement;
    exec(sql: string): void;
    query<T = unknown>(
      sql: string
    ): {
      all(...params: unknown[]): T[];
      get(...params: unknown[]): T | undefined;
    };
    close(): void;
  }
}

// Global timer declarations. Top-level `declare function` in a script
// file is the canonical way to add to the global scope. The callback
// signature must accept zero-or-more args because `Promise<T>` invokes
// the resolver with one argument of type `T` (even though our usage
// ignores it via `r => setTimeout(r, ms)`).
declare type TimeoutHandle = {
  unref(): void;
  [Symbol.toPrimitive]?(): number;
};

declare function setTimeout(
  callback: (...args: any[]) => void,
  ms?: number
): TimeoutHandle;
declare function clearTimeout(handle: TimeoutHandle | undefined | null): void;

declare function setInterval(
  callback: (...args: any[]) => void,
  ms?: number
): TimeoutHandle;
declare function clearInterval(handle: TimeoutHandle | undefined | null): void;

// Bun global namespace — minimal surface used by the workspace
// subsystem (`Bun.spawn` for subprocess management). Bun injects the
// `Bun` global at runtime; this declaration only adds the type info.
declare namespace Bun {
  interface SpawnOptions {
    cmd: readonly string[];
    cwd?: string;
    stdout?: 'pipe' | 'inherit' | 'ignore';
    stderr?: 'pipe' | 'inherit' | 'ignore';
    env?: Record<string, string>;
  }

  interface Subprocess {
    readonly stdout: ReadableStream<Uint8Array> | undefined;
    readonly stderr: ReadableStream<Uint8Array> | undefined;
    readonly exited: Promise<number>;
    kill(): void;
  }

  function spawn(options: SpawnOptions): Subprocess;
}

// Bun extends `import.meta` with `.dir` (the directory of the current
// module file). The default `ImportMeta` type only declares `.url`.
interface ImportMeta {
  readonly dir: string;
  readonly file: string;
  readonly path: string;
}

// Web `Response` global — used to read subprocess pipes as text.
// `globalThis.Response` is the canonical type; declare the var so
// `tsgo` recognizes the bare identifier.
declare let Response: typeof globalThis.Response;

// Node `process` global — only `.stderr.write(string)` is used by
// `WorktreeRunner.cleanupWorktree()`. Keep the surface narrow.
declare let process: {
  stderr: {
    write(chunk: string): boolean;
  };
  cwd(): string;
};

// Minimal `node:*` module declarations — the workspace subsystem
// imports from `node:fs/promises`, `node:os`, and `node:path`.
// The package deliberately does NOT depend on `@types/node`; this
// is the project-owned, minimal-surface alternative.
declare module 'node:fs/promises' {
  export function access(path: string): Promise<void>;
  export function mkdir(
    path: string,
    options?: { recursive?: boolean }
  ): Promise<string | undefined>;
  export function stat(
    path: string
  ): Promise<{ isDirectory(): boolean; isFile(): boolean }>;
  export function mkdtemp(prefix: string): Promise<string>;
  export function readFile(path: string, encoding: 'utf-8'): Promise<string>;
  export function rm(
    path: string,
    options?: { recursive?: boolean; force?: boolean }
  ): Promise<void>;
  export function writeFile(
    path: string,
    data: string,
    encoding?: 'utf-8'
  ): Promise<void>;
}

declare module 'node:os' {
  export function homedir(): string;
  export function tmpdir(): string;
}

declare module 'node:path' {
  export function basename(path: string, ext?: string): string;
  export function join(...segments: readonly string[]): string;
}
