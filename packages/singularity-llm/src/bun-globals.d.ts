// Ambient declarations for Bun globals used by singularity-llm.
//
// Bun 1.3.x supplies most of these at runtime; this file only adds type
// info so `bun tsc --noEmit` does not error on `bun:test`, the global
// `Bun` / `Request` / `Response` / `fetch`, `TextDecoder`, and the
// `describe` / `test` / `expect` globals used by the test suite.
// The package deliberately does NOT depend on `@types/bun` — this file
// is the self-contained, project-owned type surface for both the
// production and test layers.

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
  toThrow(
    pattern?: RegExp | string | Error | { new (...args: unknown[]): unknown }
  ): Promise<void>;
}

declare interface NotMatcher {
  toBe(expected: unknown): void;
  toEqual(expected: unknown): void;
  toBeNull(): void;
  toBeUndefined(): void;
  toBeDefined(): void;
  toBeTruthy(): void;
  toBeFalsy(): void;
  toContain(value: unknown): void;
  toThrow(
    pattern?: RegExp | string | Error | { new (...args: unknown[]): unknown }
  ): void;
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
  toContainEqual(value: unknown): void;
  toMatch(pattern: RegExp | string): void;
  toMatchObject(value: unknown): void;
  toHaveProperty(key: string, value?: unknown): void;
  toThrow(
    pattern?: RegExp | string | Error | { new (...args: unknown[]): unknown }
  ): void;
  not: NotMatcher;
  rejects: RejectsMatcher;
}

declare interface ExpectStatic {
  (value: unknown): ExpectMatcher;
  <T>(value: PromiseLike<T>): ExpectMatcher;
  objectContaining<T>(value: T): T;
  any<T>(value: T): T;
  anything(): unknown;
  arrayContaining<T>(value: T[]): T[];
  stringContaining<T>(value: T): T;
  stringMatching<T>(value: T): T;
}
declare const expect: ExpectStatic;

declare module 'bun:test' {
  export function describe(name: string, fn: () => void | Promise<void>): void;
  export function test(
    name: string,
    fn: () => void | Promise<void>,
    timeout?: number
  ): void;
  export function it(
    name: string,
    fn: () => void | Promise<void>,
    timeout?: number
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
    toContain(value: unknown): void;
    toThrow(
      pattern?: RegExp | string | Error | { new (...args: unknown[]): unknown }
    ): void;
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
    toContainEqual(value: unknown): void;
    toMatch(pattern: RegExp | string): void;
    toMatchObject(value: unknown): void;
    toHaveProperty(key: string, value?: unknown): void;
    toThrow(
      pattern?: RegExp | string | Error | { new (...args: unknown[]): unknown }
    ): void;
    not: NotMatcher;
    rejects: RejectsMatcher;
  }
  export interface ExpectStatic {
    (value: unknown): ExpectMatcher;
    <T>(value: PromiseLike<T>): ExpectMatcher;
    objectContaining<T>(value: T): T;
    any<T>(value: T): T;
    anything(): unknown;
    arrayContaining<T>(value: T[]): T[];
    stringContaining<T>(value: T): T;
    stringMatching<T>(value: T): T;
  }
  export const expect: ExpectStatic;
}

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

  interface ServeOptions {
    port?: number;
    hostname?: string;
    readonly fetch: (req: Request) => Response | Promise<Response>;
  }
  function serve(options: ServeOptions): { port: number; stop(): void };
}

declare class TextDecoder {
  constructor(encoding?: string);
  decode(
    buffer: ArrayBuffer | Uint8Array,
    options?: { stream?: boolean }
  ): string;
}

// Web platform globals — Bun ships these at runtime
declare const fetch: {
  (input: RequestInfo, init?: RequestInit): Promise<Response>;
  preconnect(options?: { rel: string; href: string }): void;
};
declare let Response: typeof globalThis.Response;
declare let Request: typeof globalThis.Request;
declare let process: {
  env: Record<string, string | undefined>;
  cwd(): string;
};
interface Response {
  readonly status: number;
  readonly statusText: string;
  readonly ok: boolean;
  readonly headers: Headers;
  readonly body: ReadableStream<Uint8Array> | null;
  json(): Promise<unknown>;
  text(): Promise<string>;
}
interface Request {
  new (input: RequestInfo, init?: RequestInit): globalThis.Request;
  prototype: globalThis.Request;
  readonly method: string;
  readonly url: string;
  readonly headers: Headers;
  json(): Promise<unknown>;
}
