// Ambient declarations for Bun + Node globals.
// This file provides type info so `tsc --noEmit` does not error on
// `bun:sqlite`, the global `Bun` / `Response` / `process`, and
// `node:fs/promises` / `node:os` / `node:path` used transitively
// through dependency packages.
//
// This is a minimal re-declaration of what singularity-core's
// bun-globals.d.ts provides; kept in sync with that file.

declare module 'bun:sqlite' {
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
      sql: string
    ): {
      all(...params: unknown[]): T[];
      get(...params: unknown[]): T | undefined;
    };
    close(): void;
  }
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
}

declare let Response: typeof globalThis.Response;

declare let process: {
  stderr: {
    write(chunk: string): boolean;
  };
  cwd(): string;
};

declare interface AbortSignal {
  readonly aborted: boolean;
  addEventListener(type: 'abort', listener: () => void): void;
  removeEventListener(type: 'abort', listener: () => void): void;
}

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
