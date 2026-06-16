// Phase 8 — `SkillAuthoringService`: platform-triggered skill drafting.
//
// Handles skill drafting triggered via Telegram/Discord messaging using
// the existing `SkillDraftCreator` and `SkillRegistry` infrastructure.
//
// Responsibilities:
//   - Accept skill context from platform messages and synthesize drafts
//   - Store pending drafts in memory (keyed by sessionId) until approved/discarded
//   - Approve drafts to register them in the registry (status: 'pending')
//   - All operations are tied to a platform session
//
// Out of scope for this phase:
//   - Database persistence (Phase 8 is in-memory only)
//   - Skill schema or registry implementation changes
//   - Modification of existing PlatformAdapter interface

import type {
  DraftResult as CoreDraftResult,
  DraftContext,
  SkillDraftCreator,
  SkillRegistry,
} from 'singularity-core';

/**
 * Platform context for skill authoring.
 */
export interface PlatformSkillContext {
  /** Source platform ('telegram' or 'discord') */
  platform: 'telegram' | 'discord';
  /** Platform-specific chat/channel ID */
  chatId: string;
  /** Singularity session ID */
  sessionId: string;
  /** Optional platform user ID */
  userId?: string;
}

/**
 * Options for drafting a skill from chat context.
 */
export interface DraftSkillFromChatOptions {
  /** User-provided name for the skill (e.g., "git/commit-msg") */
  skillName: string;
  /** Description of what the skill should do */
  sessionSummary: string;
  /** What tools were called during the session */
  toolCallSummary: string;
  /** Failures encountered and how they were fixed */
  failuresAndFixes: string;
  /** How to verify the skill works (shell commands) */
  verificationCommands: string;
  /** Skill scope: 'user' | 'project' | 'global' (default: 'user') */
  scope?: 'user' | 'project' | 'global';
}

/**
 * A pending skill draft stored in memory.
 */
export interface PendingDraft {
  /** Name of the drafted skill */
  skillName: string;
  /** Timestamp when the draft was created (ms since epoch) */
  draftedAt: number;
  /** The draft result from SkillDraftCreator */
  draft: DraftResult;
}

/**
 * Result of drafting a skill.
 * Alias for the core DraftResult for consistent typing.
 */
export type DraftResult = CoreDraftResult;

/**
 * Service for platform-triggered skill drafting.
 *
 * Uses `SkillDraftCreator` to synthesize drafts from chat context and
 * stores pending drafts in memory until explicitly approved or discarded.
 *
 * Usage:
 * ```ts
 * const registry = new SkillRegistry();
 * const draftCreator = new SkillDraftCreator();
 * const service = new SkillAuthoringService(registry, draftCreator);
 *
 * const result = await service.draftSkillFromChat(
 *   { platform: 'telegram', chatId: '123', sessionId: 'sess_abc' },
 *   { skillName: 'git/commit-msg', sessionSummary: '...', ... }
 * );
 * // result.markdown → skill file content
 * // result.skill    → pending skill object
 *
 * service.approveDraft('sess_abc', 'git/commit-msg');
 * // Skill is now registered with status: 'pending'
 * ```
 */
export class SkillAuthoringService {
  private readonly pendingDrafts = new Map<string, Map<string, PendingDraft>>();

  constructor(
    private readonly registry: SkillRegistry,
    private readonly draftCreator: SkillDraftCreator
  ) {}

  /**
   * Draft a skill from chat context.
   *
   * Synthesizes a draft using `SkillDraftCreator` and stores it in memory
   * keyed by sessionId. The draft remains pending until explicitly
   * approved or discarded.
   *
   * @throws Error if skillName is empty
   */
  async draftSkillFromChat(
    context: PlatformSkillContext,
    options: DraftSkillFromChatOptions
  ): Promise<DraftResult> {
    const {
      skillName,
      sessionSummary,
      toolCallSummary,
      failuresAndFixes,
      verificationCommands,
      scope,
    } = options;

    if (!skillName?.trim()) {
      throw new Error('skillName cannot be empty');
    }

    // Build the draft context for SkillDraftCreator
    // Note: 'global' scope is converted to 'user' (the singularity-core default)
    const effectiveScope = scope === 'global' ? 'user' : (scope ?? 'user');
    const draftContext: DraftContext = {
      name: skillName.trim(),
      sessionSummary,
      toolCallSummary,
      failuresAndFixes,
      verificationCommands: verificationCommands
        ? verificationCommands
            .split('\n')
            .map((c) => c.trim())
            .filter(Boolean)
        : [],
      scope: effectiveScope,
    };

    // Create the draft
    const draft = this.draftCreator.create(draftContext);

    // Store pending draft keyed by sessionId
    let sessionDrafts = this.pendingDrafts.get(context.sessionId);
    if (!sessionDrafts) {
      sessionDrafts = new Map();
      this.pendingDrafts.set(context.sessionId, sessionDrafts);
    }

    const pendingDraft: PendingDraft = {
      skillName: skillName.trim(),
      draftedAt: Date.now(),
      draft,
    };

    sessionDrafts.set(skillName.trim(), pendingDraft);

    return draft;
  }

  /**
   * List pending drafts for a platform session.
   */
  listPendingDrafts(sessionId: string): PendingDraft[] {
    const sessionDrafts = this.pendingDrafts.get(sessionId);
    if (!sessionDrafts) {
      return [];
    }
    return Array.from(sessionDrafts.values()).sort(
      (a, b) => b.draftedAt - a.draftedAt
    );
  }

  /**
   * Approve a pending draft — register it in the registry.
   *
   * The skill is registered with status: 'pending' (per DECISIONS.md L67
   * explicit review requirement).
   *
   * @throws Error if no draft exists for the given sessionId and skillName
   */
  approveDraft(sessionId: string, skillName: string): void {
    const sessionDrafts = this.pendingDrafts.get(sessionId);
    if (!sessionDrafts) {
      throw new Error(
        `No pending draft found for session "${sessionId}" and skill "${skillName}"`
      );
    }

    const pending = sessionDrafts.get(skillName);
    if (!pending) {
      throw new Error(
        `No pending draft found for skill "${skillName}" in session "${sessionId}"`
      );
    }

    // Register the skill in the registry
    this.registry.register(pending.draft.skill);

    // Remove from pending drafts after successful registration
    sessionDrafts.delete(skillName);

    // Clean up empty session maps
    if (sessionDrafts.size === 0) {
      this.pendingDrafts.delete(sessionId);
    }
  }

  /**
   * Discard a pending draft — remove it from memory without registering.
   */
  discardDraft(sessionId: string, skillName: string): void {
    const sessionDrafts = this.pendingDrafts.get(sessionId);
    if (!sessionDrafts) {
      return;
    }

    sessionDrafts.delete(skillName);

    // Clean up empty session maps
    if (sessionDrafts.size === 0) {
      this.pendingDrafts.delete(sessionId);
    }
  }
}
