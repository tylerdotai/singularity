// Root-level ambient declarations for Bun + Node globals.
// TypeScript automatically picks up .d.ts files at the workspace root
// for all packages, solving cross-package ambient visibility.
declare class AbortController {
  signal: AbortSignal
  abort(): void
}
declare interface AbortSignal {
  readonly aborted: boolean
  addEventListener(type: 'abort', listener: () => void): void
  removeEventListener(type: 'abort', listener: () => void): void
}
declare class Buffer {
  static from(str: string): Buffer
}
declare namespace Bun {
  interface SpawnOptions {
    cmd: readonly string[]
    cwd?: string
    stdout?: 'pipe' | 'inherit' | 'ignore'
    stderr?: 'pipe' | 'inherit' | 'ignore'
    env?: Record<string, string>
    signal?: AbortSignal
  }
  interface Subprocess {
    readonly stdout: ReadableStream<Uint8Array> | undefined
    readonly stderr: ReadableStream<Uint8Array> | undefined
    readonly exited: Promise<number>
    kill(): void
  }
  function spawn(options: SpawnOptions): Subprocess
}
declare let process: {
  env: Record<string, string | undefined>
  stderr: { write(chunk: string): boolean }
}
