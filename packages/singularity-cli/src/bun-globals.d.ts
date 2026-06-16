// Ambient type declarations — self-contained, no @types/bun or @types/node
// dependency.
declare module 'bun:test' {
  export { afterEach, beforeEach, describe, expect, test } from 'bun';
}

declare const process: {
  stdout: { write: (s: string) => boolean; isTTY?: boolean };
  stderr: { write: (s: string) => boolean; isTTY?: boolean };
  argv: string[];
  cwd: () => string;
  chdir: (path: string) => void;
  env: Record<string, string | undefined>;
  exit: (code: number) => never;
};

// Minimum `bun:sqlite` surface used by the TUI panels when they open a
// profile DB. The panels call `prepare` (returning a statement with
// `run` / `all` / `get`), `exec` for `CREATE TABLE IF NOT EXISTS`
// schema bootstrap, and `close` to release the file handle after the
// read finishes.
declare module 'bun:sqlite' {
  export interface Statement {
    run(...params: unknown[]): {
      changes: number;
      lastInsertRowid: number | bigint;
    };
    all<T = unknown>(...params: unknown[]): T[];
    get<T = unknown>(...params: unknown[]): T | undefined;
  }

  export class Database {
    constructor(path: string);
    prepare(sql: string): Statement;
    exec(sql: string): void;
    close(): void;
  }
}

// `Bun` global — used by `WorktreeRunner.runSubprocess` (which is
// imported transitively from `singularity-core`). The TUI panels
// themselves only need a narrow surface, but typechecking the
// transitive graph requires the `Bun.spawn` shape.
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

// Web `Response` global — used by `WorktreeRunner` to read subprocess
// pipes as text. `globalThis.Response` is the canonical type; declare
// the var so `tsc` recognizes the bare identifier.
declare let Response: typeof globalThis.Response;

// Minimal `node:*` ambient surfaces — the panels shell out to `git`
// and resolve the `~/.singularity` trash dir, both of which require
// `homedir()` and `join()`. The package deliberately does NOT depend
// on `@types/node`; this is the project-owned minimal-surface
// alternative.
declare module 'node:fs/promises' {
  export function access(path: string): Promise<void>;
  export function mkdir(
    path: string,
    options?: { recursive?: boolean }
  ): Promise<string | undefined>;
  export function stat(
    path: string
  ): Promise<{ isDirectory(): boolean; isFile(): boolean }>;
}

// Synchronous `node:fs` surface used by the panel test fixture
// (`mkdtempSync` to create an isolated temp dir per test, `rmSync`
// to clean it up in `afterEach`). Both are part of Node's stable
// `fs` API; declaring only the methods we use keeps the ambient
// surface narrow and matches the project discipline of
// "no @types/node, just the bits we need".
declare module 'node:fs' {
  export function mkdtempSync(prefix: string): string;
  export function rmSync(
    path: string,
    options?: { recursive?: boolean; force?: boolean }
  ): void;
}

declare module 'node:os' {
  export function homedir(): string;
  export function tmpdir(): string;
}

declare module 'node:path' {
  export function join(...segments: readonly string[]): string;
  export function basename(path: string, ext?: string): string;
}

// `solid-js` ambient — the panel files import from the explicit client
// build path (`solid-js/dist/solid.js`) instead of the bare `solid-js`
// specifier. Reason: under Bun the bare specifier resolves to
// `solid-js/dist/server.js` (the SSR / neutered build) via the
// `node` conditional in the package's `exports` map. That build
// throws on `createResource` because it requires a hydrating SSR
// context. OpenTUI's renderer is non-DOM and non-hydrating, so we
// route to the client build by explicit path — the same path
// `@opentui/solid` uses internally.
//
// The `./dist/*` exports entry in `solid-js/package.json` allows the
// import but does NOT ship a `.d.ts` for the dist subpath. Re-export
// the types from the package's main `types` entry so the panel
// imports keep their full type information (in particular
// `Setter<T>` so `setSignal((prev) => ...)` infers `prev`).
declare module 'solid-js/dist/solid.js' {
  export type { JSX } from 'solid-js';
  export * from 'solid-js';
}

declare module '@opentui/solid/preload' {}
