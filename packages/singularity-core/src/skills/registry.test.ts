// Phase 3.1 — `SkillRegistry` unit tests.
//
// The four `describe(...)` blocks below are the IMPLEMENTATION_PLAN
// Task 3.1 test-first scenarios (`docs/singularity/IMPLEMENTATION_PLAN.md`
// lines 224-229). Each scenario maps 1:1 to a public contract of
// `SkillRegistry`:
//
//   1. "load active skill"     → `register` + `get` + default `list`
//   2. "hide pending skill"    → default `list` hides pending; `includeHidden` reveals it
//   3. "deny skill by policy"  → `setPolicy` rejection throws and leaves registry untouched
//   4. "nested skill names"    → exact-match keys, prefix queries
//
// `beforeEach` constructs a fresh `SkillRegistry` so the tests are
// isolated and order-independent.

import { beforeEach, describe, expect, it } from 'bun:test';

import { SkillRegistry } from './registry.ts';
import type { Skill } from './schema.ts';

// Test fixture: a baseline active skill. Individual tests override the
// fields they care about (notably `status` for the "hide pending" case).
function makeSkill(overrides: Partial<Skill> = {}): Skill {
  return {
    profileId: null,
    scope: 'user',
    name: 'git/commit',
    path: '/skills/git/commit.md',
    description: 'Draft a git commit message from a diff.',
    version: '1.0.0',
    status: 'active',
    source: 'local',
    provenance: {},
    ...overrides,
  };
}

describe('SkillRegistry', () => {
  let registry: SkillRegistry;

  beforeEach(() => {
    registry = new SkillRegistry();
  });

  describe('load active skill', () => {
    it('register() stores a skill retrievable by get() and visible in default list()', () => {
      const skill = makeSkill();
      registry.register(skill);

      const fetched = registry.get(skill.name);
      expect(fetched).toBeDefined();
      expect(fetched?.name).toBe(skill.name);
      expect(fetched?.status).toBe('active');
      expect(fetched?.description).toBe(skill.description);

      const listed = registry.list();
      expect(listed).toHaveLength(1);
      expect(listed[0]?.name).toBe(skill.name);
    });

    it('size() reflects the registered count', () => {
      expect(registry.size()).toBe(0);
      registry.register(makeSkill({ name: 'a' }));
      expect(registry.size()).toBe(1);
      registry.register(makeSkill({ name: 'b' }));
      expect(registry.size()).toBe(2);
    });
  });

  describe('hide pending skill', () => {
    it('pending skills are hidden from default list() but visible with includeHidden', () => {
      const pending = makeSkill({ name: 'auto-skill-1', status: 'pending' });
      registry.register(pending);

      // `get()` returns the skill regardless of status (the registry
      // does not filter individual lookups).
      const fetched = registry.get(pending.name);
      expect(fetched).toBeDefined();
      expect(fetched?.status).toBe('pending');

      // Default `list()` hides pending skills (explicit review per
      // `docs/singularity/DECISIONS.md` L67).
      const defaultList = registry.list();
      expect(defaultList).toHaveLength(0);

      // Opt in to see all statuses.
      const all = registry.list({ includeHidden: true });
      expect(all).toHaveLength(1);
      expect(all[0]?.name).toBe(pending.name);

      // `list({ status: "pending" })` returns the pending skill
      // without needing `includeHidden`.
      const pendingOnly = registry.list({ status: 'pending' });
      expect(pendingOnly).toHaveLength(1);
      expect(pendingOnly[0]?.name).toBe(pending.name);
    });

    it('approve() flips a pending skill into the default-visible set', () => {
      const pending = makeSkill({ name: 'auto-skill-2', status: 'pending' });
      registry.register(pending);
      expect(registry.list()).toHaveLength(0);

      registry.approve(pending.name);
      expect(registry.list()).toHaveLength(1);
      expect(registry.list({ includeHidden: true })).toHaveLength(1);
      expect(registry.get(pending.name)?.status).toBe('active');
    });
  });

  describe('deny skill by policy', () => {
    it('a policy that returns false causes register() to throw and leaves the registry empty', () => {
      // Policy denies every skill whose name starts with "blocked/".
      registry.setPolicy((skill) => !skill.name.startsWith('blocked/'));

      const denied = makeSkill({
        name: 'blocked/dangerous',
        path: '/skills/blocked/dangerous.md',
      });

      // `register()` throws with a descriptive message.
      expect(() => registry.register(denied)).toThrow(/denied by policy/);

      // The denied skill is NOT in the registry.
      expect(registry.get(denied.name)).toBeUndefined();
      expect(registry.size()).toBe(0);
      expect(registry.list({ includeHidden: true })).toHaveLength(0);
    });

    it('a custom policy that allows specific skills lets them through', () => {
      // Allow only skills whose source is "imported".
      registry.setPolicy((skill) => skill.source === 'imported');

      const allowed = makeSkill({ name: 'imported/ok', source: 'imported' });
      const blocked = makeSkill({ name: 'local/blocked', source: 'local' });

      expect(() => registry.register(allowed)).not.toThrow();
      expect(() => registry.register(blocked)).toThrow(/denied by policy/);

      expect(registry.size()).toBe(1);
      expect(registry.get(allowed.name)).toBeDefined();
      expect(registry.get(blocked.name)).toBeUndefined();
    });
  });

  describe('nested skill names', () => {
    it('treats nested names as exact-match identifiers (no path resolution)', () => {
      const commit = makeSkill({ name: 'git/commit' });
      const rebase = makeSkill({
        name: 'git/rebase',
        description: 'Rebase onto a base.',
      });
      registry.register(commit);
      registry.register(rebase);

      // Exact-match lookups return the right skill.
      const commitFetched = registry.get('git/commit');
      expect(commitFetched).toBeDefined();
      expect(commitFetched?.description).toBe(commit.description);

      const rebaseFetched = registry.get('git/rebase');
      expect(rebaseFetched).toBeDefined();
      expect(rebaseFetched?.description).toBe(rebase.description);

      // The parent name does NOT match — no directory traversal.
      expect(registry.get('git')).toBeUndefined();
    });

    it('list({ namePrefix: "git/" }) returns both nested skills', () => {
      const commit = makeSkill({ name: 'git/commit' });
      const rebase = makeSkill({ name: 'git/rebase' });
      const unrelated = makeSkill({
        name: 'docker/build',
        path: '/skills/docker/build.md',
        description: 'Build a docker image.',
      });
      registry.register(commit);
      registry.register(rebase);
      registry.register(unrelated);

      const gitSkills = registry.list({ namePrefix: 'git/' });
      expect(gitSkills).toHaveLength(2);
      const names = gitSkills.map((s) => s.name);
      expect(names).toContain('git/commit');
      expect(names).toContain('git/rebase');
      expect(names.includes('docker/build')).toBe(false);
    });
  });
});
