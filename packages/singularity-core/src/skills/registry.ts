// Phase 3.1 — `SkillRegistry`: in-memory metadata wrapper for skills.
//
// Responsibilities:
//   - Hold a `Map<name, Skill>` of registered skills (exact-match keys,
//     no path resolution — `git/commit` and `git` are distinct names).
//   - Enforce a `SkillPolicy` predicate at `register()` time. Denied
//     skills never enter the registry; the policy is NOT re-checked on
//     `get()` / `list()` because denied skills are already absent.
//   - Hide `pending` and `denied` skills from the default `list()` view
//     (explicit review per `docs/singularity/DECISIONS.md` line 67).
//
// Out of scope for this phase:
//   - DB-backed storage (Phase 4 follow-up per `ARCHITECTURE.md` L182-195)
//   - Frontmatter parsing (Phase 3.2 validator)
//   - Filesystem reading (`loadFromPath()` — future phase)
//   - `skills.sql.ts` and migrations (future phase)
//
// Mutation model: `Skill` is `readonly`, so `setStatus` / `approve` /
// `deny` construct a fresh `Skill` object with the new status (and an
// augmented `provenance` when a `reason` is supplied) and re-store it
// under the same name. The previous object is replaced; no in-place
// mutation is possible.

import type { Skill, SkillFilter, SkillPolicy, SkillStatus } from './schema.ts';

/**
 * In-memory skill registry.
 *
 * Storage is a flat `Map<string, Skill>` keyed by `skill.name`. Nested
 * names like `git/commit` are exact-match identifiers — `get("git")`
 * does NOT match `git/commit`. There is no path resolution, no
 * directory traversal, no fuzzy matching. The flat shape keeps the
 * registry predictable: two skills with the same name collide, and
 * the second `register()` overwrites the first.
 */
export class SkillRegistry {
  private readonly skills = new Map<string, Skill>();
  private policy: SkillPolicy = () => true; // default: allow all

  /**
   * Replace the current policy. The new policy is enforced on every
   * subsequent `register()` call; skills already in the registry are
   * NOT re-evaluated (the policy is a registration gate, not a
   * read-time filter).
   */
  setPolicy(policy: SkillPolicy): void {
    this.policy = policy;
  }

  /**
   * Register a skill. Throws if the current `SkillPolicy` denies it.
   *
   * Keyed by `skill.name`. If a skill with the same name is already
   * registered, this call overwrites the previous entry — the
   * registry's last-writer-wins semantics are intentional (callers
   * that need history use the future DB layer).
   */
  register(skill: Skill): void {
    if (!this.policy(skill)) {
      throw new Error(`skill "${skill.name}" denied by policy`);
    }
    this.skills.set(skill.name, skill);
  }

  /**
   * Look up a skill by name. Returns the skill regardless of its
   * `status` — the registry does not filter individual lookups; the
   * caller decides whether a `pending` or `denied` skill is usable
   * in their context. Use `list()` for status-filtered views.
   */
  get(name: string): Skill | undefined {
    return this.skills.get(name);
  }

  /**
   * List registered skills with optional filtering.
   *
   * Default behavior (no filter / empty filter): returns ONLY
   * `active` skills. `pending` and `denied` are hidden because
   * `DECISIONS.md` L67 mandates explicit review before a skill
   * becomes loadable.
   *
   * Filters are AND-combined. All fields are optional. To see hidden
   * skills, pass `includeHidden: true`. To see only pending skills,
   * pass `status: "pending"` (no need for `includeHidden`).
   */
  list(filter?: SkillFilter): Skill[] {
    // Resolve the effective status filter. Three cases:
    //   1. `filter.status` is set            → that status only (any includeHidden)
    //   2. `filter.includeHidden === true`   → any status
    //   3. otherwise (no filter at all)      → "active" only (hide pending + denied)
    let effectiveStatus: SkillStatus | null;
    if (filter?.status !== undefined) {
      effectiveStatus = filter.status;
    } else if (filter?.includeHidden === true) {
      effectiveStatus = null;
    } else {
      effectiveStatus = 'active';
    }

    const result: Skill[] = [];

    for (const skill of this.skills.values()) {
      if (effectiveStatus !== null && skill.status !== effectiveStatus) {
        continue;
      }
      if (filter?.scope !== undefined && skill.scope !== filter.scope) {
        continue;
      }
      if (filter?.source !== undefined && skill.source !== filter.source) {
        continue;
      }
      if (
        filter?.profileId !== undefined &&
        skill.profileId !== filter.profileId
      ) {
        continue;
      }
      if (
        filter?.namePrefix !== undefined &&
        !skill.name.startsWith(filter.namePrefix)
      ) {
        continue;
      }
      result.push(skill);
    }

    return result;
  }

  /**
   * Change a skill's status. If `reason` is supplied, it is recorded
   * in the skill's `provenance` under the `statusReason` key — the
   * approval-trail pattern the future DB layer will read from.
   *
   * Throws if the named skill is not registered. The status is
   * replaced in-place via a new `Skill` object (the `readonly`
   * constraint on `Skill` fields forbids mutation).
   */
  setStatus(name: string, status: SkillStatus, reason?: string): void {
    const existing = this.skills.get(name);
    if (existing === undefined) {
      throw new Error(`skill "${name}" not found`);
    }

    const nextProvenance =
      reason !== undefined
        ? { ...existing.provenance, statusReason: reason }
        : existing.provenance;

    const updated: Skill = {
      profileId: existing.profileId,
      scope: existing.scope,
      name: existing.name,
      path: existing.path,
      description: existing.description,
      version: existing.version,
      status,
      source: existing.source,
      provenance: nextProvenance,
    };

    this.skills.set(name, updated);
  }

  /**
   * Convenience: `setStatus(name, "active")`. Used by the future
   * approval workflow (Phase 4) and by tests that need to flip a
   * pending skill into the default-visible state.
   */
  approve(name: string): void {
    this.setStatus(name, 'active');
  }

  /**
   * Convenience: `setStatus(name, "denied", reason)`. Records the
   * reason in `provenance.statusReason` so audit views can show why
   * the skill was blocked.
   */
  deny(name: string, reason: string): void {
    this.setStatus(name, 'denied', reason);
  }

  /**
   * Remove a skill from the registry entirely. Returns `true` if a
   * skill was removed, `false` if no skill with that name was
   * registered. Useful for tests and for hot-reload flows that
   * re-register a skill after a file change.
   */
  unregister(name: string): boolean {
    return this.skills.delete(name);
  }

  /**
   * Count of registered skills across ALL statuses (active, pending,
   * denied). Use this for telemetry; use `list().length` to count
   * only the active subset.
   */
  size(): number {
    return this.skills.size;
  }
}
