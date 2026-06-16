// Phase 3.3 — `SkillDraftCreator`: synthesize a pending skill draft
// from session/tool data.
//
// Responsibilities:
//   - Accept a `DraftContext` (session summary, tool-call summary,
//     failures and fixes, verification commands, name) and produce a
//     `DraftResult` containing both:
//       1. A Markdown string formatted to pass the Phase 3.2 validator
//          (frontmatter `name` + `description`, body sections
//          `## When to use`, `## Implementation`,
//          `## Failures and fixes`, `## Verification`).
//       2. A `Skill` object with `status: "pending"` (per
//          `docs/singularity/DECISIONS.md` L67 explicit review) and
//          `source: "auto-drafted"` (per the `SkillSource` union).
//   - Persist the full input context in `Skill.provenance` so the
//     future approval workflow can audit the draft.
//
// Out of scope for this phase:
//   - Filesystem writing (the draft is returned as a string; a future
//     phase may add `writeDraft(path, draft)`)
//   - `SkillRegistry` integration (the draft is returned as a `Skill`
//     object; registration is a future concern)
//   - `SkillValidator` integration (the caller decides when to
//     validate; the template is designed to pass but it is NOT
//     enforced at draft time)
//   - LLM-based drafting (this is a deterministic template engine;
//     LLM-based drafting is a future phase)
//
// Design decisions (mirror the plan's "Key Design Decisions" section):
//   1. No LLM — deterministic template.
//   2. No filesystem writing — output is a string.
//   3. No registry integration — output is a `Skill` object.
//   4. No validation — the template is designed to pass Phase 3.2 but
//      the caller decides when to run it.
//   5. Pending by default — `status: "pending"` (explicit review).
//   6. Source = "auto-drafted" — set in `SkillSource` for this case.
//   7. Provenance captures the full input context.
//   8. Path is a placeholder — Phase 3.3 does not write to disk; a
//      future phase that writes the draft replaces the placeholder.
//   9. Version starts at 0.1.0 — initial draft.
//   10. Scope and profileId are optional — default to `'user'` and
//       `null` (unscoped global).

import type { Skill, SkillScope } from './schema.ts';

/**
 * The maximum length of the derived `description` field. The
 * frontmatter description is the first 200 characters of the
 * `sessionSummary` (trimmed); a trailing `...` is appended when the
 * summary exceeds this limit.
 */
const DESCRIPTION_MAX_LENGTH = 200;

/**
 * The placeholder path used by the `Skill.path` field. Phase 3.3 does
 * not write to disk; a future phase that writes the draft to a file
 * will replace this with the actual path.
 */
const PENDING_PATH_PLACEHOLDER = '<pending — not yet written to disk>';

/**
 * The initial semantic version stamped on auto-drafted skills. Future
 * edits to a draft can bump it.
 */
const INITIAL_DRAFT_VERSION = '0.1.0';

/**
 * The default scope for an auto-drafted skill. Matches
 * `SkillRegistry`'s default visibility (user-scoped, unscoped
 * profile). Callers can override via `DraftContext.scope`.
 */
const DEFAULT_SCOPE: SkillScope = 'user';

/**
 * The default profileId for an auto-drafted skill (`null` =
 * unscoped global). Callers can override via
 * `DraftContext.profileId`.
 */
const DEFAULT_PROFILE_ID: string | null = null;

/**
 * Input to the draft creator — the context for synthesizing a skill.
 *
 * The five required fields capture the "what was done / how / what
 * went wrong / how to verify" narrative that the Markdown template
 * embeds. The two optional fields carry registry metadata; both
 * default to unscoped global.
 */
export interface DraftContext {
  /** User-provided skill name (e.g., `"git/commit-msg"`). */
  readonly name: string;
  /** Prose: what was done. */
  readonly sessionSummary: string;
  /** Prose: what tools were called. */
  readonly toolCallSummary: string;
  /** Prose: what went wrong and how it was fixed. */
  readonly failuresAndFixes: string;
  /** Shell commands that verify the work. */
  readonly verificationCommands: readonly string[];
  /** Where a skill is registered. Defaults to `'user'`. */
  readonly scope?: SkillScope;
  /** Profile association. `null` = unscoped global. Defaults to `null`. */
  readonly profileId?: string | null;
}

/**
 * Output of the draft creator — a pending skill ready for review.
 *
 * `markdown` is the file content formatted to pass the Phase 3.2
 * validator. `skill` is the in-memory `Skill` object the caller can
 * inspect, edit, persist, register, or validate as needed.
 */
export interface DraftResult {
  /** The skill file content (passes Phase 3.2 validator). */
  readonly markdown: string;
  /** The `Skill` object (`status: "pending"`, `source: "auto-drafted"`). */
  readonly skill: Skill;
}

/**
 * Synthesizes a pending skill draft from session/tool data.
 *
 * The creator is a deterministic template engine — it does NOT call
 * any LLM. The output Markdown is formatted to pass the Phase 3.2
 * validator (frontmatter `name` + `description`; body sections
 * `## When to use`, `## Implementation`, `## Failures and fixes`,
 * `## Verification`). The output `Skill` object has
 * `status: "pending"` (per `DECISIONS.md` L67 explicit review) and
 * `source: "auto-drafted"` (per the `SkillSource` union).
 *
 * Usage:
 * ```ts
 * const creator = new SkillDraftCreator();
 * const result = creator.create({
 *   name: 'git/commit-msg',
 *   sessionSummary: '...',
 *   toolCallSummary: '...',
 *   failuresAndFixes: '...',
 *   verificationCommands: ['bun run typecheck', 'bun test'],
 * });
 * // result.markdown → save / inspect / edit
 * // result.skill    → register / validate / audit
 * ```
 *
 * The class is stateless — every `create()` call is independent.
 * Instances are cheap to construct; the class is held as a class
 * (not a free function) so the future approval workflow can inject
 * extensions (e.g., a custom description truncator) without changing
 * call sites.
 */
export class SkillDraftCreator {
  /**
   * Generate a draft from the given context.
   *
   * The two halves of the result are built independently and
   * returned together so the caller can use either or both. The
   * `draftedAt` timestamp on the provenance is the only
   * non-deterministic field; everything else is a pure function
   * of the input context.
   */
  create(context: DraftContext): DraftResult {
    const markdown = this.buildMarkdown(context);
    const skill = this.buildSkill(context);
    return { markdown, skill };
  }

  /**
   * Derive the frontmatter `description` from the session summary.
   *
   * The description is the first 200 characters of the summary,
   * trimmed. If the trimmed summary exceeds 200 characters, the
   * first 200 characters (right-trimmed) are kept and `...` is
   * appended. This gives a concise one-line description suitable
   * for the frontmatter and the registry's list view.
   */
  private descriptionFromSummary(summary: string): string {
    const trimmed = summary.trim();
    if (trimmed.length <= DESCRIPTION_MAX_LENGTH) {
      return trimmed;
    }
    return `${trimmed.slice(0, DESCRIPTION_MAX_LENGTH).trimEnd()}...`;
  }

  /**
   * Assemble the Markdown string. The output has the 4 required
   * sections (`## When to use`, `## Implementation`,
   * `## Failures and fixes`, `## Verification`) and the frontmatter
   * (`name` + `description`).
   *
   * The `## Verification` section renders each command as a
   * fenced code block. An empty `verificationCommands` array still
   * emits the `## Verification` heading — the validator checks
   * for the heading, not for commands under it.
   */
  private buildMarkdown(context: DraftContext): string {
    const description = this.descriptionFromSummary(context.sessionSummary);
    const verificationBlocks = context.verificationCommands
      .map((cmd) => `\`\`\`sh\n${cmd}\n\`\`\``)
      .join('\n\n');

    return `---
name: ${context.name}
description: ${description}
---

## When to use

${context.sessionSummary}

## Implementation

${context.toolCallSummary}

## Failures and fixes

${context.failuresAndFixes}

## Verification

${verificationBlocks}
`;
  }

  /**
   * Construct the `Skill` object. Defaults `scope` to `'user'` and
   * `profileId` to `null`; sets `status: "pending"` (per
   * `DECISIONS.md` L67 explicit review) and `source: "auto-drafted"`
   * (per the `SkillSource` union). The full input context is
   * stored in `provenance` for future audit and review.
   *
   * The `path` field is a sentinel placeholder — Phase 3.3 does
   * not write the draft to disk. A future phase that writes the
   * draft to a file will replace this with the actual path.
   */
  private buildSkill(context: DraftContext): Skill {
    return {
      profileId: context.profileId ?? DEFAULT_PROFILE_ID,
      scope: context.scope ?? DEFAULT_SCOPE,
      name: context.name,
      path: PENDING_PATH_PLACEHOLDER,
      description: this.descriptionFromSummary(context.sessionSummary),
      version: INITIAL_DRAFT_VERSION,
      status: 'pending',
      source: 'auto-drafted',
      provenance: {
        sourceSessionSummary: context.sessionSummary,
        sourceToolCallSummary: context.toolCallSummary,
        sourceFailuresAndFixes: context.failuresAndFixes,
        sourceVerificationCommands: [...context.verificationCommands],
        draftedAt: new Date().toISOString(),
      },
    };
  }
}
