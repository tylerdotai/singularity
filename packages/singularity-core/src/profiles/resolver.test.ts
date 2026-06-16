// Phase 6.1 — `ProfileResolver` unit tests.
//
// The six `it(...)` blocks below are the IMPLEMENTATION_PLAN Phase 6.1
// Task 2.5 test-first scenarios for the resolver (`docs/IMPLEMENTATION_PLAN.md`
// lines 510-517). Each scenario maps 1:1 to a public method or invariant:
//
//   1. default profile resolution            → `resolveDefault` (auto-create)
//   2. idempotent resolveDefault             → `resolveDefault` (second call)
//   3. explicit name resolution              → `resolve('work')` (read-only)
//   4. unknown name throws                   → `resolve('ghost')` (defensive)
//   5. project override precedence           → `resolveForProject(cwd)`
//   6. invalid profile handling (4 sub-cases) → `validateProfileName` order
//
// Each test gets a fresh temp profile root + temp cwd via
// `createTempProfileRoot()` in `beforeEach` / inside the test. Temp
// dirs are tracked in a module-level set and removed in `afterEach`
// (mirroring the `WorktreeRunner` test fixture pattern) so the FS is
// left clean and tests are order-independent.
//
// The resolver uses real `node:fs/promises` wrappers via the default
// `ProfileResolverFs`; we do not inject a fake. The bootstrap path
// opens a `bun:sqlite` `Database` internally — the resolver closes it
// in its own `finally`, so the test does not need to manage the
// connection lifecycle.

import { Database } from 'bun:sqlite';
import { afterEach, describe, expect, it } from 'bun:test';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  ProfileNameError,
  ProfileNotFoundError,
  type ProfilePath,
  ProfileResolver,
  ProfileStore,
} from './index.ts';

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

/** Module-level set of temp dirs to clean up in `afterEach`. */
const tempDirs = new Set<string>();

/**
 * Create a fresh temp dir for use as a profile root (or as a `cwd` for
 * `resolveForProject`). The dir name is unique per call (mkdtemp
 * generates a random suffix) and tracked for cleanup.
 */
async function createTempProfileRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'singularity-profile-'));
  tempDirs.add(dir);
  return dir;
}

/**
 * Type predicate that narrows a `ProfilePath` to its `'profile'`
 * variant. `expect()` does not act as a type guard, so the discriminated
 * union cannot be narrowed via an assertion chain alone — this helper
 * lets the test body write `if (isProfile(result))` once and have all
 * subsequent assertions type-check against the `'profile'` shape.
 */
function isProfile(
  p: ProfilePath
): p is Extract<ProfilePath, { kind: 'profile' }> {
  return p.kind === 'profile';
}

// -----------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------

describe('ProfileResolver', () => {
  afterEach(async () => {
    // Best-effort cleanup; ignore individual failures so one stuck
    // dir doesn't cascade and fail the whole suite.
    for (const dir of tempDirs) {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
    tempDirs.clear();
  });

  it('resolveDefault auto-creates the default profile DB on first call', async () => {
    const root = await createTempProfileRoot();
    const resolver = new ProfileResolver(root);

    const result = await resolver.resolveDefault();

    // `resolveDefault` always returns a `'profile'` variant — the
    // resolver never produces a `'project-local'` path from this
    // call. Narrow via the type predicate so the subsequent
    // `result.name` access type-checks.
    expect(isProfile(result)).toBe(true);
    if (!isProfile(result)) return;
    expect(result.name).toBe('default');
    expect(result.created).toBe(true);
    // Path fields point at the absolute path of the freshly-created
    // `<root>/default/state.db`.
    expect(result.path).toBe(join(root, 'default', 'state.db'));
    expect(result.stateDbPath).toBe(join(root, 'default', 'state.db'));
    expect(result.rootPath).toBe(join(root, 'default'));

    // The DB file actually exists on disk and contains a `default`
    // profile row (the resolver's `bootstrapDefault()` ran the
    // migrations + inserted the row before closing the connection).
    const db = new Database(result.path);
    try {
      const store = new ProfileStore(db);
      const defaultRow = store.getByName('default');
      expect(defaultRow).not.toBeNull();
      expect(defaultRow?.root_path).toBe(join(root, 'default'));
    } finally {
      db.close();
    }
  });

  it('resolveDefault is idempotent — second call returns created=false with the same path', async () => {
    const root = await createTempProfileRoot();
    const resolver = new ProfileResolver(root);

    const first = await resolver.resolveDefault();
    const second = await resolver.resolveDefault();

    // Both calls return a `'profile'` variant (idempotent
    // re-resolution of `'default'` cannot produce a
    // `'project-local'` variant). Narrow via the type predicate so
    // the `result.name` access type-checks.
    expect(isProfile(second)).toBe(true);
    if (!isProfile(second)) return;
    expect(second.name).toBe('default');
    expect(second.created).toBe(false);
    expect(second.path).toBe(first.path);
    expect(second.stateDbPath).toBe(first.stateDbPath);
    expect(second.rootPath).toBe(first.rootPath);
  });

  it('resolve("work") returns a profile path for a pre-existing migrated DB', async () => {
    const root = await createTempProfileRoot();
    const workDir = join(root, 'work');
    await mkdir(workDir, { recursive: true });

    // Pre-create a valid migrated DB at `<root>/work/state.db` with
    // a `work` profile row. The resolver's current implementation
    // only checks file existence, but a real migrated DB future-proofs
    // the test against a future resolver strengthening (e.g. one that
    // asserts the schema is present).
    const db = new Database(join(workDir, 'state.db'));
    try {
      const store = new ProfileStore(db);
      store.migrate();
      store.create({ name: 'work', root_path: workDir });
    } finally {
      db.close();
    }

    const resolver = new ProfileResolver(root);
    const result = await resolver.resolve('work');

    // A pre-existing named profile resolves to the `'profile'`
    // variant; only the `'default'` name auto-creates, and only
    // `resolveForProject` produces a `'project-local'` variant.
    // Narrow via the type predicate so the `result.name` access
    // type-checks.
    expect(isProfile(result)).toBe(true);
    if (!isProfile(result)) return;
    expect(result.name).toBe('work');
    expect(result.created).toBe(false);
    expect(result.path).toBe(join(workDir, 'state.db'));
    expect(result.stateDbPath).toBe(join(workDir, 'state.db'));
    expect(result.rootPath).toBe(workDir);
  });

  it('resolve("ghost") against a clean root throws ProfileNotFoundError with profileName="ghost"', async () => {
    const root = await createTempProfileRoot();
    const resolver = new ProfileResolver(root);

    let caught: unknown;
    try {
      await resolver.resolve('ghost');
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ProfileNotFoundError);
    // The error instance stores the offending name so the CLI can
    // surface it back to the user.
    expect((caught as ProfileNotFoundError).profileName).toBe('ghost');
    // `profileId` is the store-side identifier; not set on the
    // resolver-side error path.
    expect((caught as ProfileNotFoundError).profileId).toBeUndefined();
  });

  it('resolveForProject returns a project-local path without creating the default profile', async () => {
    const root = await createTempProfileRoot();
    const cwd = await createTempProfileRoot();

    // Pre-write a file at `<cwd>/.singularity/state.db`. The
    // resolver only checks file existence, so the file contents do
    // not matter; an empty file is sufficient.
    const projDir = join(cwd, '.singularity');
    await mkdir(projDir, { recursive: true });
    const projStateDb = join(projDir, 'state.db');
    await writeFile(projStateDb, '');

    const resolver = new ProfileResolver(root);
    const result = await resolver.resolveForProject(cwd);

    // `kind: 'project-local'`, no `name` (project-local DBs are not
    // associated with a profile directory in the resolver's mental
    // model), `created: false` — the file was pre-existing.
    expect(result.kind).toBe('project-local');
    expect(result.created).toBe(false);
    expect(result.path).toBe(projStateDb);
    expect(result.stateDbPath).toBe(projStateDb);
    expect(result.rootPath).toBe(projDir);

    // Critical invariant: the default profile directory was NOT
    // created as a side effect. The resolver must NOT fall through
    // to `resolveDefault()` when the project-local file exists.
    let defaultDirExists = false;
    try {
      await access(join(root, 'default'));
      defaultDirExists = true;
    } catch {
      defaultDirExists = false;
    }
    expect(defaultDirExists).toBe(false);
  });

  it('resolve with invalid names throws ProfileNameError with the matching reason', async () => {
    const root = await createTempProfileRoot();
    const resolver = new ProfileResolver(root);

    // --- empty ---
    let caught: unknown;
    try {
      await resolver.resolve('');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ProfileNameError);
    expect((caught as ProfileNameError).reason).toBe('empty');

    // --- too_long (65 chars; regex max is 64) ---
    caught = undefined;
    try {
      await resolver.resolve('a'.repeat(65));
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ProfileNameError);
    expect((caught as ProfileNameError).reason).toBe('too_long');

    // --- path_traversal (`../escape` contains `/`) ---
    caught = undefined;
    try {
      await resolver.resolve('../escape');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ProfileNameError);
    expect((caught as ProfileNameError).reason).toBe('path_traversal');

    // --- invalid_characters (whitespace is outside the regex) ---
    caught = undefined;
    try {
      await resolver.resolve('has space');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ProfileNameError);
    expect((caught as ProfileNameError).reason).toBe('invalid_characters');
  });
});
