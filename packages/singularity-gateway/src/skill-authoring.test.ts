import { beforeEach, describe, expect, it } from 'bun:test';
import { SkillDraftCreator, SkillRegistry } from 'singularity-core';
import {
  type PlatformSkillContext,
  SkillAuthoringService,
} from './skill-authoring.js';

function createTestContext(
  overrides: Partial<PlatformSkillContext> = {}
): PlatformSkillContext {
  return {
    platform: 'telegram',
    chatId: '123456',
    sessionId: 'session_abc123',
    userId: 'user_789',
    ...overrides,
  };
}

describe('SkillAuthoringService', () => {
  let registry: SkillRegistry;
  let draftCreator: SkillDraftCreator;
  let service: SkillAuthoringService;

  beforeEach(() => {
    registry = new SkillRegistry();
    draftCreator = new SkillDraftCreator();
    service = new SkillAuthoringService(registry, draftCreator);
  });

  describe('draftSkillFromChat', () => {
    it('creates a draft and stores it', async () => {
      const context = createTestContext();
      const options = {
        skillName: 'git/commit-msg',
        sessionSummary: 'Automated git commit message generation',
        toolCallSummary: 'Called git diff and git commit with message',
        failuresAndFixes:
          'Initial version had empty messages - added validation',
        verificationCommands: 'bun run test\nbun run lint',
        scope: 'user' as const,
      };

      const result = await service.draftSkillFromChat(context, options);

      expect(result.markdown).toContain('name: git/commit-msg');
      expect(result.markdown).toContain('## When to use');
      expect(result.markdown).toContain('## Implementation');
      expect(result.markdown).toContain('## Failures and fixes');
      expect(result.markdown).toContain('## Verification');

      expect(result.skill.name).toBe('git/commit-msg');
      expect(result.skill.status).toBe('pending');
      expect(result.skill.source).toBe('auto-drafted');
      expect(result.skill.scope).toBe('user');

      // Verify draft is stored
      const drafts = service.listPendingDrafts(context.sessionId);
      expect(drafts).toHaveLength(1);
      expect(drafts[0].skillName).toBe('git/commit-msg');
    });

    it('creates draft with project scope', async () => {
      const context = createTestContext();
      const options = {
        skillName: 'project/build',
        sessionSummary: 'Build the project',
        toolCallSummary: 'Called npm run build',
        failuresAndFixes: 'None',
        verificationCommands: 'npm run build',
        scope: 'project' as const,
      };

      const result = await service.draftSkillFromChat(context, options);

      expect(result.skill.scope).toBe('project');
    });

    it('throws error for empty skill name', async () => {
      const context = createTestContext();
      const options = {
        skillName: '',
        sessionSummary: 'Test summary',
        toolCallSummary: 'Test tools',
        failuresAndFixes: 'Test fixes',
        verificationCommands: 'npm test',
      };

      await expect(
        service.draftSkillFromChat(context, options)
      ).rejects.toThrow('skillName cannot be empty');
    });

    it('throws error for whitespace-only skill name', async () => {
      const context = createTestContext();
      const options = {
        skillName: '   ',
        sessionSummary: 'Test summary',
        toolCallSummary: 'Test tools',
        failuresAndFixes: 'Test fixes',
        verificationCommands: 'npm test',
      };

      await expect(
        service.draftSkillFromChat(context, options)
      ).rejects.toThrow('skillName cannot be empty');
    });

    it('allows multiple drafts for different skills in same session', async () => {
      const context = createTestContext();

      await service.draftSkillFromChat(context, {
        skillName: 'skill-one',
        sessionSummary: 'Summary 1',
        toolCallSummary: 'Tools 1',
        failuresAndFixes: 'Fixes 1',
        verificationCommands: 'test1',
      });

      await service.draftSkillFromChat(context, {
        skillName: 'skill-two',
        sessionSummary: 'Summary 2',
        toolCallSummary: 'Tools 2',
        failuresAndFixes: 'Fixes 2',
        verificationCommands: 'test2',
      });

      const drafts = service.listPendingDrafts(context.sessionId);
      expect(drafts).toHaveLength(2);
    });
  });

  describe('listPendingDrafts', () => {
    it('returns empty array for unknown session', () => {
      const drafts = service.listPendingDrafts('unknown_session');
      expect(drafts).toHaveLength(0);
    });

    it('returns drafts sorted by draftedAt descending', async () => {
      const context = createTestContext();

      await service.draftSkillFromChat(context, {
        skillName: 'first-skill',
        sessionSummary: 'First skill',
        toolCallSummary: 'Tools',
        failuresAndFixes: 'Fixes',
        verificationCommands: 'test',
      });

      // Small delay to ensure different timestamps
      await new Promise((resolve) => setTimeout(resolve, 10));

      await service.draftSkillFromChat(context, {
        skillName: 'second-skill',
        sessionSummary: 'Second skill',
        toolCallSummary: 'Tools',
        failuresAndFixes: 'Fixes',
        verificationCommands: 'test',
      });

      const drafts = service.listPendingDrafts(context.sessionId);
      expect(drafts).toHaveLength(2);
      expect(drafts[0].skillName).toBe('second-skill'); // Most recent first
      expect(drafts[1].skillName).toBe('first-skill');
    });
  });

  describe('approveDraft', () => {
    it('registers the skill in the registry', async () => {
      const context = createTestContext();
      const options = {
        skillName: 'git/commit-msg',
        sessionSummary: 'Automated git commit',
        toolCallSummary: 'Called git diff and git commit',
        failuresAndFixes: 'Added validation for empty messages',
        verificationCommands: 'bun run test',
      };

      await service.draftSkillFromChat(context, options);
      service.approveDraft(context.sessionId, 'git/commit-msg');

      // Verify skill is registered
      const skill = registry.get('git/commit-msg');
      expect(skill).toBeDefined();
      expect(skill?.name).toBe('git/commit-msg');
      expect(skill?.status).toBe('pending');
      expect(skill?.source).toBe('auto-drafted');
    });

    it('removes draft from pending after approval', async () => {
      const context = createTestContext();
      const options = {
        skillName: 'test-skill',
        sessionSummary: 'Test summary',
        toolCallSummary: 'Test tools',
        failuresAndFixes: 'Test fixes',
        verificationCommands: 'npm test',
      };

      await service.draftSkillFromChat(context, options);
      expect(service.listPendingDrafts(context.sessionId)).toHaveLength(1);

      service.approveDraft(context.sessionId, 'test-skill');

      expect(service.listPendingDrafts(context.sessionId)).toHaveLength(0);
    });

    it('throws error for unknown session', () => {
      expect(() => {
        service.approveDraft('unknown_session', 'some-skill');
      }).toThrow(/No pending draft found/);
    });

    it('throws error for unknown skill name', async () => {
      const context = createTestContext();
      await service.draftSkillFromChat(context, {
        skillName: 'existing-skill',
        sessionSummary: 'Summary',
        toolCallSummary: 'Tools',
        failuresAndFixes: 'Fixes',
        verificationCommands: 'test',
      });

      expect(() => {
        service.approveDraft(context.sessionId, 'nonexistent-skill');
      }).toThrow(/No pending draft found/);
    });
  });

  describe('discardDraft', () => {
    it('removes the draft without registering', async () => {
      const context = createTestContext();
      const options = {
        skillName: 'discarded-skill',
        sessionSummary: 'To be discarded',
        toolCallSummary: 'Test tools',
        failuresAndFixes: 'Test fixes',
        verificationCommands: 'npm test',
      };

      await service.draftSkillFromChat(context, options);
      expect(service.listPendingDrafts(context.sessionId)).toHaveLength(1);

      service.discardDraft(context.sessionId, 'discarded-skill');

      expect(service.listPendingDrafts(context.sessionId)).toHaveLength(0);
      expect(registry.get('discarded-skill')).toBeUndefined();
    });

    it('does not throw for unknown session', () => {
      service.discardDraft('unknown_session', 'some-skill'); // Should not throw
    });

    it('does not throw for unknown skill name', async () => {
      const context = createTestContext();
      await service.draftSkillFromChat(context, {
        skillName: 'existing-skill',
        sessionSummary: 'Summary',
        toolCallSummary: 'Tools',
        failuresAndFixes: 'Fixes',
        verificationCommands: 'test',
      });

      service.discardDraft(context.sessionId, 'nonexistent-skill'); // Should not throw
      expect(service.listPendingDrafts(context.sessionId)).toHaveLength(1);
    });

    it('cleans up empty session maps', async () => {
      const context = createTestContext();
      await service.draftSkillFromChat(context, {
        skillName: 'solo-skill',
        sessionSummary: 'Summary',
        toolCallSummary: 'Tools',
        failuresAndFixes: 'Fixes',
        verificationCommands: 'test',
      });

      service.discardDraft(context.sessionId, 'solo-skill');

      // Session map should be cleaned up
      expect(service.listPendingDrafts(context.sessionId)).toHaveLength(0);
    });
  });

  describe('discord platform support', () => {
    it('accepts discord platform context', async () => {
      const context = createTestContext({ platform: 'discord' });
      const options = {
        skillName: 'discord-skill',
        sessionSummary: 'Discord-specific skill',
        toolCallSummary: 'Tools',
        failuresAndFixes: 'Fixes',
        verificationCommands: 'test',
      };

      const result = await service.draftSkillFromChat(context, options);
      expect(result.skill.name).toBe('discord-skill');
    });
  });
});
