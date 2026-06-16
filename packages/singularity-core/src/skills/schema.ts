// Phase 3.1 — skill registry schema types.
//
// Pure type declarations: no runtime code. The `SkillRegistry` class
// (in `./registry.ts`) consumes these types and the `Skill` interface
// is the canonical shape handed to `register()`.
//
// Status / scope / source union members mirror the future `skills` table
// from `docs/singularity/ARCHITECTURE.md` lines 184-195, minus the
// DB-specific fields (id, created_at, updated_at) which a future DB
// layer will add. The DB layer is intentionally NOT in this phase —
// Phase 3.1 is an in-memory metadata wrapper.

// Visibility of a registered skill.
//   - "active" → loadable, visible in default `list()`
//   - "pending" → hidden from default `list()` (explicit review per
//                 `docs/singularity/DECISIONS.md` line 67)
//   - "denied"  → blocked by policy, hidden from default `list()`
export type SkillStatus = 'active' | 'pending' | 'denied';

// Where a skill is registered. Mirrors the future `skills.profile_id`
// join from `ARCHITECTURE.md` line 186.
export type SkillScope = 'user' | 'project' | 'profile';

// Provenance origin. Phase 3.3 (auto-skill draft) will use
// "auto-drafted" for skills synthesized by the system.
export type SkillSource = 'local' | 'imported' | 'auto-drafted';

// Opaque JSON-serializable metadata: import URL, author, content hash,
// approval trail, etc. Constrained to JSON-compatible values so future
// persistence layers can store it as a TEXT column or document field.
export type SkillProvenance = Readonly<Record<string, unknown>>;

// A registered skill.
//
// The interface mirrors the future `skills` table from
// `ARCHITECTURE.md` lines 184-195, minus DB-specific fields. All fields
// are `readonly` so a `Skill` value is immutable once handed to
// `register()`. Mutation flows through `SkillRegistry.setStatus()` /
// `approve()` / `deny()`, which replace the stored entry.
export interface Skill {
  readonly profileId: string | null; // null = unscoped (global)
  readonly scope: SkillScope;
  readonly name: string; // may be nested: "git/commit"
  readonly path: string; // filesystem path to the skill file
  readonly description: string;
  readonly version: string;
  readonly status: SkillStatus;
  readonly source: SkillSource;
  readonly provenance: SkillProvenance;
}

// Policy function: returns `true` to allow the skill, `false` to deny.
// The default policy (if `setPolicy` is never called) is allow-all.
// A returning `false` from `setPolicy`'s argument during `register()`
// causes `register()` to throw — denied skills never enter the registry.
export type SkillPolicy = (skill: Skill) => boolean;

// Optional filter for `SkillRegistry.list()`. All fields are optional;
// an empty filter returns only `active` skills by default. To see
// `pending` and `denied` skills, pass `includeHidden: true`.
export interface SkillFilter {
  readonly status?: SkillStatus;
  readonly scope?: SkillScope;
  readonly source?: SkillSource;
  readonly profileId?: string | null;
  readonly namePrefix?: string; // for nested-name prefix queries
  readonly includeHidden?: boolean; // true = include pending + denied
}
