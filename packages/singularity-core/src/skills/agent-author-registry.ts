// Phase 11 — `SkillAuthoringPipeline`: draft + validate + register.
//
// Responsibilities:
//   - Combine `AgentSkillAuthor` and `SkillRegistry` into a single
//     pipeline for drafting, validating, and registering skills.
//   - `createAndRegisterSkill()`: draft + validate + register in one call.
//   - `draftSkillForReview()`: draft but don't register (return for review).
//   - `registerDraft()`: register a reviewed draft.
//
// Out of scope for this phase:
//   - Skill file writing (the draft is returned as a string; a future
//     phase may add `writeDraft()`)
//   - Database persistence (Phase 4 follow-up per ARCHITECTURE.md)

import type {
  AgentSkillAuthor,
  AgentSkillAuthorInput,
  AgentSkillDraftResult,
} from './agent-author.js';
import type { SkillRegistry } from './registry.js';
import type { Skill, SkillScope } from './schema.ts';

export class SkillAuthoringPipeline {
  private readonly author: AgentSkillAuthor;
  private readonly registry: SkillRegistry;

  constructor(author: AgentSkillAuthor, registry: SkillRegistry) {
    this.author = author;
    this.registry = registry;
  }

  async createAndRegisterSkill(
    input: AgentSkillAuthorInput,
    options?: { scope?: SkillScope; profileId?: string }
  ): Promise<Skill> {
    const draft = await this.author.draftSkill(input);
    return this.registerDraft(draft, options);
  }

  async draftSkillForReview(
    input: AgentSkillAuthorInput
  ): Promise<AgentSkillDraftResult> {
    return this.author.draftSkill(input);
  }

  registerDraft(
    draft: AgentSkillDraftResult,
    options?: { scope?: SkillScope; profileId?: string }
  ): Skill {
    const skill: Skill = {
      profileId: options?.profileId ?? null,
      scope: options?.scope ?? 'user',
      name: draft.name,
      path: '<pending — not yet written to disk>',
      description: draft.description,
      version: '0.1.0',
      status: 'pending',
      source: 'auto-drafted',
      provenance: {
        ...draft.provenance,
        sourceFailuresAndFixes: draft.failuresAndFixes,
        sourceVerificationCommands: draft.verificationCommands,
      },
    };

    this.registry.register(skill);
    return skill;
  }
}
