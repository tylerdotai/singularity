// Phase 6.1 — `ProfileResolver`: filesystem + SQLite layer that turns a
// profile identity (or the default, or a project-local override) into
// an absolute path to a `state.db` file.
//
// Per `docs/ARCHITECTURE.md` lines 64-90:
//   - One SQLite DB per profile.
//   - Default at `~/.singularity/profiles/default/state.db`.
//   - Project-local override `.singularity/state.db` is read-only (the
//     resolver returns the path; it does NOT create project-local DBs).
//
// Semantics:
//   - `resolve(name)`: validate the name; check
//     `<profileRoot>/<name>/state.db`. If missing AND name !== 'default',
//     throw `ProfileNotFoundError({ name })`. If missing AND name ===
//     'default', bootstrap the default profile (mkdir + open DB +
//     migrate + insert default row). If the file exists, return the
//     path with `created: false`.
//   - `resolveDefault()`: equivalent to `resolve('default')`. Bootstrap
//     the default profile on first call; subsequent calls return
//     `created: false`.
//   - `resolveForProject(cwd)`: check `<cwd>/.singularity/state.db`.
//     If present, return a `'project-local'` `ProfilePath` with
//     `created: false` (no default profile is touched). If absent,
//     fall back to `resolveDefault()` (which MAY create the default
//     profile as a side effect — the expected fallback per
//     `ARCHITECTURE.md` line 69).
//
// Database lifecycle:
//   The resolver opens a `bun:sqlite` `Database` to run
//   `ProfileStore.migrate()` on the bootstrap path. Every open is
//   followed by a `db.close()` in a `finally` block to avoid
//   file-handle leaks. The resolver never holds a DB open across
//   calls — it returns a `ProfilePath` and the caller opens the DB
//   itself.
//
// One-way dependency direction: resolver → store → errors. The store
// does NOT import from the resolver. The resolver duplicates the
// store's private `validateProfileName` logic rather than exporting
// it from the store (Task 2.2 contract: the store is not modified
// in Task 2.3).

import { Database } from 'bun:sqlite';
import {
  access as nodeAccess,
  mkdir as nodeMkdir,
  stat as nodeStat,
} from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Minimal process.env ambient — `@types/bun` doesn't expose it,
// and importing `@types/node` everywhere is overkill. Callers that
// want a non-default home set SINGULARITY_HOME; everything else falls
// through to the regular `homedir()`.
declare const process: { env: Record<string, string | undefined> };

import { ProfileNameError, ProfileNotFoundError } from './errors.js';
import { ProfileStore } from './store.js';

// ---------- Types ----------

/**
 * Resolved path to a profile DB. A discriminated union over `kind`:
 *
 *   - `'profile'`: a named profile at `<profileRoot>/<name>/state.db`.
 *     The `name` field carries the profile directory name.
 *   - `'project-local'`: a project-scoped override at
 *     `<cwd>/.singularity/state.db`. No `name` is associated with
 *     project-local DBs (they are arbitrary SQLite files at a
 *     well-known path; the resolver does not manage their schema or
 *     rows).
 *
 * `path` and `stateDbPath` carry the same value (the absolute path to
 * the `state.db` file). Both are exposed per the task spec; callers
 * that need a strict single-field API can read either.
 *
 * `rootPath` is the containing directory:
 *   - `'profile'` kind: `<profileRoot>/<name>`
 *   - `'project-local'` kind: `<cwd>/.singularity`
 *
 * `created` is `true` on the first call to `resolveDefault()` (or
 * `resolve('default')`) when the resolver just created the directory
 * and the DB. Subsequent calls return `created: false`.
 */
export type ProfilePath =
  | {
      readonly kind: 'profile';
      readonly name: string;
      readonly path: string;
      readonly rootPath: string;
      readonly stateDbPath: string;
      readonly created: boolean;
    }
  | {
      readonly kind: 'project-local';
      readonly path: string;
      readonly rootPath: string;
      readonly stateDbPath: string;
      readonly created: boolean;
    };

/**
 * Filesystem surface used by the resolver. Injectable so the test
 * fixture can swap in a custom impl or use the real
 * `node:fs/promises` via `defaultResolverFs`. The interface is the
 * minimum needed by the resolver: `access` (existence check),
 * `mkdir` (recursive directory creation), and `stat` (file/directory
 * distinction — reserved for future validators; the Phase 6.1 logic
 * does not consume `stat`, but it is exposed on the interface so
 * tests can pass a custom impl and so a future "verify this is a
 * valid profile directory" method has the right surface).
 */
export interface ProfileResolverFs {
  access(path: string): Promise<void>;
  mkdir(
    path: string,
    options?: { recursive?: boolean }
  ): Promise<string | undefined>;
  stat(path: string): Promise<{ isDirectory(): boolean; isFile(): boolean }>;
}

/**
 * Real-`node:fs/promises` implementation of `ProfileResolverFs`. Used
 * in production; tests may pass a custom `ProfileResolverFs` via the
 * `options.fs` constructor argument.
 *
 * `stat` is wrapped directly: a real `node:fs/promises.stat` returns
 * a `Stats` object whose `isDirectory()` / `isFile()` methods match
 * the structural type declared in `ProfileResolverFs.stat`. The
 * ambient `node:fs/promises` declaration in `bun-globals.d.ts`
 * exposes `stat` with that same structural shape.
 */
export const defaultResolverFs: ProfileResolverFs = {
  access: (path) => nodeAccess(path),
  mkdir: (path, options) => nodeMkdir(path, options),
  stat: (path) => nodeStat(path),
};

// ---------- Helpers ----------

/**
 * Character class the resolver trusts as a directory name. Mirrors
 * `ProfileStore`'s private `PROFILE_NAME_REGEX` exactly. A profile
 * name is also a safe directory name (no `/`, `\\`, `.`, `..`).
 */
const PROFILE_NAME_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;

/**
 * Validate a profile name and throw a `ProfileNameError` with the
 * matching `ProfileNameReason` discriminator on failure. The check
 * order matches `ProfileStore.validateProfileName`:
 * `empty` → `too_long` → `path_traversal` → `invalid_characters`.
 *
 * Duplicated from the store because the store's helper is private
 * (Task 2.2 contract: the store is not modified in Task 2.3). The
 * two implementations MUST stay in sync; if a future phase exposes
 * the store's helper, this one can be removed in favor of a single
 * source of truth.
 */
function validateProfileName(name: string): void {
  if (name.length === 0) {
    throw new ProfileNameError(name, 'empty');
  }
  if (name.length > 64) {
    throw new ProfileNameError(name, 'too_long');
  }
  if (
    name === '.' ||
    name === '..' ||
    name.includes('/') ||
    name.includes('\\')
  ) {
    throw new ProfileNameError(name, 'path_traversal');
  }
  if (!PROFILE_NAME_REGEX.test(name)) {
    throw new ProfileNameError(name, 'invalid_characters');
  }
}

// ---------- Implementation ----------

/**
 * Resolver that turns a profile identity into an absolute path to a
 * `state.db` file. Owns the bootstrap sequence: the first call to
 * `resolveDefault()` (or `resolve('default')`) creates the default
 * profile's directory + DB and runs `ProfileStore.migrate()`. Named
 * profiles are resolved read-only; a missing named profile throws
 * `ProfileNotFoundError` (Phase 7 CLI `singularity profile create`
 * is the explicit creation path).
 *
 * Constructor:
 *   - `profileRoot`: root directory for named profiles. Defaults to
 *     `join(homedir(), '.singularity', 'profiles')` (an absolute path
 *     on all supported platforms because `homedir()` is absolute).
 *     Callers that pass a custom value SHOULD pass an absolute path;
 *     relative values are accepted but produce relative `path`
 *     fields in the returned `ProfilePath`.
 *   - `options.fs`: injectable `ProfileResolverFs`. Defaults to
 *     `defaultResolverFs` (real `node:fs/promises` wrappers).
 *   - `options.projectLocalName`: project-local override path
 *     relative to `cwd`. Defaults to `.singularity/state.db` per
 *     `ARCHITECTURE.md` line 69.
 */
export class ProfileResolver {
  private readonly profileRoot: string;
  private readonly projectLocalName: string;
  private readonly fs: ProfileResolverFs;

  constructor(
    profileRoot?: string,
    options?: { fs?: ProfileResolverFs; projectLocalName?: string }
  ) {
    this.profileRoot =
      profileRoot ??
      join(
        process.env.SINGULARITY_HOME ?? homedir(),
        '.singularity',
        'profiles'
      );
    this.projectLocalName =
      options?.projectLocalName ?? '.singularity/state.db';
    this.fs = options?.fs ?? defaultResolverFs;
  }

  /**
   * Resolve a named profile to an absolute `state.db` path. The
   * `'default'` name is special: it auto-creates the default profile
   * (mkdir + open DB + migrate + default row) on first call. Other
   * named profiles are resolved read-only; a missing profile throws
   * `ProfileNotFoundError({ name })`.
   */
  async resolve(name: string): Promise<ProfilePath> {
    validateProfileName(name);
    const rootPath = join(this.profileRoot, name);
    const stateDbPath = join(rootPath, 'state.db');

    if (await this.fileExists(stateDbPath)) {
      return {
        kind: 'profile',
        name,
        path: stateDbPath,
        rootPath,
        stateDbPath,
        created: false,
      };
    }

    if (name === 'default') {
      return this.bootstrapDefault(rootPath, stateDbPath);
    }

    throw new ProfileNotFoundError({ name });
  }

  /**
   * Resolve the default profile. Equivalent to `resolve('default')`:
   * creates the directory + DB on first call (returns `created: true`),
   * returns `created: false` on every subsequent call.
   */
  async resolveDefault(): Promise<ProfilePath> {
    return this.resolve('default');
  }

  /**
   * Resolve a project-local profile DB at `<cwd>/<projectLocalName>`.
   * If the file exists, returns a `'project-local'` `ProfilePath`
   * with `created: false` and the default profile is NOT touched
   * (no directory + no DB is created as a side effect). If the file
   * is absent, falls back to `resolveDefault()`.
   */
  async resolveForProject(cwd: string): Promise<ProfilePath> {
    const rootPath = join(cwd, '.singularity');
    const stateDbPath = join(cwd, this.projectLocalName);

    if (await this.fileExists(stateDbPath)) {
      return {
        kind: 'project-local',
        path: stateDbPath,
        rootPath,
        stateDbPath,
        created: false,
      };
    }

    return this.resolveDefault();
  }

  // ---------- Private helpers ----------

  /**
   * `fs.access` returns void on success and throws on absence. Wrap
   * it in a boolean for the resolver's "exists?" branches. Any
   * thrown error (file not found, permission denied, etc.) is
   * treated as "does not exist" — the resolver never wants to
   * surface raw filesystem errors from an existence probe.
   */
  private async fileExists(path: string): Promise<boolean> {
    try {
      await this.fs.access(path);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Bootstrap the default profile: mkdir the parent dirs, open the
   * DB, run `ProfileStore.migrate()`, ensure a `default` row exists
   * in the `profiles` table with `root_path` pointing at the default
   * profile directory. The DB is closed in a `finally` block to
   * avoid file-handle leaks. Always returns a `'profile'` `ProfilePath`
   * with `created: true`.
   */
  private async bootstrapDefault(
    rootPath: string,
    stateDbPath: string
  ): Promise<ProfilePath> {
    await this.fs.mkdir(this.profileRoot, { recursive: true });
    await this.fs.mkdir(rootPath, { recursive: true });

    const db = new Database(stateDbPath);
    try {
      const store = new ProfileStore(db);
      store.migrate();
      if (store.getByName('default') === null) {
        store.create({ name: 'default', root_path: rootPath });
      }
    } finally {
      db.close();
    }

    return {
      kind: 'profile',
      name: 'default',
      path: stateDbPath,
      rootPath,
      stateDbPath,
      created: true,
    };
  }
}
