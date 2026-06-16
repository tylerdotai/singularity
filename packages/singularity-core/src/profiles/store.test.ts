// Phase 6.1 — `ProfileStore` unit tests.
//
// The eight `it(...)` blocks below are the IMPLEMENTATION_PLAN Phase 6.1
// Task 2.5 test-first scenarios (`docs/IMPLEMENTATION_PLAN.md` lines
// 499-508). Each maps 1:1 to a public method or invariant of
// `ProfileStore`:
//
//   1. creates a profile                    → `ProfileStore.create`
//   2. rejects duplicate name               → `ProfileStore.create` (UNIQUE)
//   3. rejects invalid name (4 sub-cases)   → `ProfileStore.create` validation
//   4. getById / getByName round-trip        → `ProfileStore.getById` / `getByName`
//   5. list returns profiles DESC           → `ProfileStore.list`
//   6. setDefaultAgent updates              → `ProfileStore.setDefaultAgent`
//   7. delete removes the row               → `ProfileStore.delete`
//   8. delete of unknown id throws          → `ProfileStore.delete` (defensive)
//
// Each test gets a fresh in-memory `bun:sqlite` + migrated `ProfileStore`
// via `createTestStore()` in `beforeEach`. `:memory:` databases are
// isolated per connection in SQLite, so the tests are order-independent
// and never leak state.

import { Database } from 'bun:sqlite';
import { beforeEach, describe, expect, it } from 'bun:test';

import {
  ProfileNameError,
  ProfileNotFoundError,
  ProfileStore,
} from './index.ts';

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

/**
 * Create a fresh in-memory SQLite database, apply every migration in
 * `ProfileStore.MIGRATIONS` (currently just `007_profiles`), and return
 * a ready-to-use `ProfileStore`. The DB handle is intentionally not
 * returned — the store owns the connection for the duration of one
 * test, and the `:memory:` database goes out of scope with the store.
 */
function createTestStore(): ProfileStore {
  const db = new Database(':memory:');
  const store = new ProfileStore(db);
  store.migrate();
  return store;
}

// -----------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------

describe('ProfileStore', () => {
  let store: ProfileStore;

  beforeEach(() => {
    store = createTestStore();
  });

  it('creates a profile with all 6 fields populated, default_agent_id null, root_path defaulted', () => {
    const profile = store.create({ name: 'work' });

    // Generated id is `prof_<32 hex chars>`.
    expect(profile.id.startsWith('prof_')).toBe(true);
    expect(profile.id.length).toBe('prof_'.length + 32);
    expect(profile.id).toMatch(/^prof_[0-9a-f]{32}$/);

    // All 6 fields populated.
    expect(profile.name).toBe('work');
    // `root_path` defaults to `''` when the caller omits it.
    expect(profile.root_path).toBe('');
    // `default_agent_id` defaults to `null` when the caller omits it.
    expect(profile.default_agent_id).toBeNull();
    // `created_at` / `updated_at` are set by `datetime('now')` in the
    // migration's DEFAULT clause; we only assert they're non-empty
    // strings (the exact format is an SQLite concern, not a
    // ProfileStore concern).
    expect(typeof profile.created_at).toBe('string');
    expect(profile.created_at.length).toBeGreaterThan(0);
    expect(typeof profile.updated_at).toBe('string');
    expect(profile.updated_at.length).toBeGreaterThan(0);
  });

  it('rejects duplicate name via the UNIQUE constraint at the DB layer', () => {
    store.create({ name: 'work' });

    // `validateProfileName('work')` passes (the name is well-formed);
    // the INSERT then trips the `name` UNIQUE constraint. The store
    // does not catch this — it propagates the SQLite error directly,
    // so we assert on the message shape.
    expect(() => store.create({ name: 'work' })).toThrow(
      /UNIQUE constraint failed/i
    );
  });

  it('rejects invalid names with the matching ProfileNameError.reason discriminator', () => {
    // --- empty ---
    let caught: unknown;
    try {
      store.create({ name: '' });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ProfileNameError);
    expect((caught as ProfileNameError).reason).toBe('empty');

    // --- too_long (65 chars, regex max is 64) ---
    caught = undefined;
    try {
      store.create({ name: 'a'.repeat(65) });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ProfileNameError);
    expect((caught as ProfileNameError).reason).toBe('too_long');

    // --- path_traversal (`..` matches the explicit guard) ---
    caught = undefined;
    try {
      store.create({ name: '..' });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ProfileNameError);
    expect((caught as ProfileNameError).reason).toBe('path_traversal');

    // --- invalid_characters (whitespace is outside the regex) ---
    caught = undefined;
    try {
      store.create({ name: 'has space' });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ProfileNameError);
    expect((caught as ProfileNameError).reason).toBe('invalid_characters');
  });

  it('getById and getByName round-trip an inserted profile, and return null for unknown keys', () => {
    const created = store.create({ name: 'work', root_path: '/tmp/work' });

    // Round-trip by id.
    const byId = store.getById(created.id);
    expect(byId).not.toBeNull();
    expect(byId?.id).toBe(created.id);
    expect(byId?.name).toBe('work');
    expect(byId?.root_path).toBe('/tmp/work');
    expect(byId?.default_agent_id).toBeNull();

    // Round-trip by name.
    const byName = store.getByName('work');
    expect(byName).not.toBeNull();
    expect(byName?.id).toBe(created.id);
    expect(byName?.root_path).toBe('/tmp/work');

    // Unknown id / name → null (no throw).
    expect(store.getById('prof_'.padEnd('prof_'.length + 32, '0'))).toBeNull();
    expect(store.getByName('ghost')).toBeNull();
  });

  it('list returns all profiles ordered by created_at DESC (newest first)', async () => {
    const a = store.create({ name: 'alpha' });
    // SQLite's `datetime('now')` has second-level resolution; sleep
    // 1.1s between inserts to guarantee strictly-greater `created_at`
    // values for the DESC ordering assertion.
    await new Promise((r) => setTimeout(r, 1100));
    const b = store.create({ name: 'beta' });
    await new Promise((r) => setTimeout(r, 1100));
    const c = store.create({ name: 'gamma' });

    const profiles = store.list();
    expect(profiles).toHaveLength(3);
    // Newest first: C, B, A.
    expect(profiles[0]?.id).toBe(c.id);
    expect(profiles[1]?.id).toBe(b.id);
    expect(profiles[2]?.id).toBe(a.id);
  }, 10_000);

  it('setDefaultAgent updates default_agent_id and bumps updated_at', async () => {
    const created = store.create({ name: 'work' });
    const originalCreatedAt = created.created_at;

    // Sleep so `updated_at = datetime('now')` is strictly greater than
    // the `created_at` captured above (second-level resolution).
    await new Promise((r) => setTimeout(r, 1100));

    const updated = store.setDefaultAgent(created.id, 'agent_alpha');

    expect(updated.default_agent_id).toBe('agent_alpha');
    // `created_at` is untouched by the UPDATE.
    expect(updated.created_at).toBe(originalCreatedAt);
    // `updated_at` is bumped to a fresh `datetime('now')` call.
    expect(updated.updated_at).not.toBe(originalCreatedAt);
    expect(updated.updated_at.length).toBeGreaterThan(0);

    // Round-trip: a fresh read sees the post-update row.
    const fetched = store.getById(created.id);
    expect(fetched?.default_agent_id).toBe('agent_alpha');
  }, 10_000);

  it('delete removes the row', () => {
    const created = store.create({ name: 'work' });
    expect(store.getById(created.id)).not.toBeNull();
    expect(store.getByName('work')).not.toBeNull();

    store.delete(created.id);

    expect(store.getById(created.id)).toBeNull();
    expect(store.getByName('work')).toBeNull();
  });

  it('delete of an unknown id throws ProfileNotFoundError with profileId set', () => {
    const unknownId = 'prof_'.padEnd('prof_'.length + 32, '0');

    let caught: unknown;
    try {
      store.delete(unknownId);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ProfileNotFoundError);
    // The error instance stores the offending id so the CLI can
    // surface it back to the user.
    expect((caught as ProfileNotFoundError).profileId).toBe(unknownId);
    // `profileName` is the resolver-side identifier; not set on the
    // store-side error path.
    expect((caught as ProfileNotFoundError).profileName).toBeUndefined();
  });
});
