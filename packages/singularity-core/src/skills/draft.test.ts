// Phase 3.3 — `SkillDraftCreator` unit tests.
//
// The eight `describe(...)` blocks below are the IMPLEMENTATION_PLAN
// Task 3.3 test-first scenarios (`docs/singularity/IMPLEMENTATION_PLAN.md`
// lines 256-276), 1:1 with the public contract of `SkillDraftCreator`:
//
//   1. "creates a draft with correct frontmatter"   → name + description in frontmatter
//   2. "draft Markdown has all 4 required sections" → ## When to use / Implementation /
//                                                     Failures and fixes / Verification
//   3. "draft status is pending"                    → result.skill.status === 'pending'
//   4. "draft source is auto-drafted"               → result.skill.source === 'auto-drafted'
//   5. "draft provenance captures full context"     → provenance contains all input fields
//   6. "description is truncated to 200 chars"      → long sessionSummary → '...' suffix
//   7. "short description is not truncated"         → short sessionSummary → no '...'
//   8. "default scope and profileId"                → defaults: 'user' scope, null profileId
//
// `beforeEach` constructs a fresh `SkillDraftCreator` so the tests are
// isolated and order-independent.

import { beforeEach, describe, expect, it } from 'bun:test';

import type { DraftContext } from './draft.ts';
import { SkillDraftCreator } from './draft.ts';

// Test fixture: a baseline valid `DraftContext`. Individual tests
// override the fields they care about (long sessionSummary for the
// truncation test, missing scope/profileId for the defaults test).
function makeContext(overrides: Partial<DraftContext> = {}): DraftContext {
  return {
    name: 'git/commit-msg',
    sessionSummary:
      'Draft a git commit message from a staged diff using the conventional commits spec.',
    toolCallSummary:
      'Called `git diff --cached` to extract the change set, then rendered the commit message header + body.',
    failuresAndFixes:
      'Initially forgot to strip the diff `index` line; fixed by anchoring the diff parser on `diff --git`.',
    verificationCommands: ['git diff --cached --quiet', 'bun test'],
    ...overrides,
  };
}

describe('SkillDraftCreator', () => {
  let creator: SkillDraftCreator;

  beforeEach(() => {
    creator = new SkillDraftCreator();
  });

  describe('creates a draft with correct frontmatter', () => {
    it('places the context name in the frontmatter `name` field', () => {
      const result = creator.create(makeContext({ name: 'docker/build' }));

      // The frontmatter `name:` line appears before the first
      // `##` heading.
      const frontmatterEnd = result.markdown.indexOf('---', 4);
      expect(frontmatterEnd).toBeGreaterThan(0);
      const frontmatter = result.markdown.slice(0, frontmatterEnd + 3);
      expect(frontmatter).toContain('name: docker/build');
    });

    it('derives the frontmatter `description` from the sessionSummary', () => {
      const summary =
        'Draft a git commit message from a staged diff using the conventional commits spec.';
      const result = creator.create(makeContext({ sessionSummary: summary }));

      const frontmatterEnd = result.markdown.indexOf('---', 4);
      const frontmatter = result.markdown.slice(0, frontmatterEnd + 3);
      // Short summary is not truncated, so the description
      // equals the trimmed summary verbatim.
      expect(frontmatter).toContain(`description: ${summary}`);
    });

    it('the result.skill.description matches the frontmatter description', () => {
      const result = creator.create(makeContext());

      // Both the Markdown frontmatter and the Skill object
      // surface the same derived description. The Skill's
      // `description` field is the registry-facing view.
      expect(result.skill.description).toBe(
        'Draft a git commit message from a staged diff using the conventional commits spec.'
      );
    });
  });

  describe('draft Markdown has all 4 required sections', () => {
    it('contains `## When to use` followed by the sessionSummary', () => {
      const summary =
        'When the user asks for a commit draft from a staged diff.';
      const result = creator.create(makeContext({ sessionSummary: summary }));

      expect(result.markdown).toContain('## When to use');
      const triggerIdx = result.markdown.indexOf('## When to use');
      const summaryIdx = result.markdown.indexOf(
        summary,
        triggerIdx + '## When to use'.length
      );
      expect(triggerIdx).toBeGreaterThan(-1);
      expect(summaryIdx).toBeGreaterThan(triggerIdx);
    });

    it('contains `## Implementation` followed by the toolCallSummary', () => {
      const tools =
        'Used `git diff --cached` and a conventional-commits renderer.';
      const result = creator.create(makeContext({ toolCallSummary: tools }));

      expect(result.markdown).toContain('## Implementation');
      const implIdx = result.markdown.indexOf('## Implementation');
      const toolsIdx = result.markdown.indexOf(tools);
      expect(implIdx).toBeGreaterThan(-1);
      expect(toolsIdx).toBeGreaterThan(implIdx);
    });

    it('contains `## Failures and fixes` followed by the failuresAndFixes prose', () => {
      const fixes =
        'First pass dropped the index line; fixed by anchoring on `diff --git`.';
      const result = creator.create(makeContext({ failuresAndFixes: fixes }));

      expect(result.markdown).toContain('## Failures and fixes');
      const fixesIdx = result.markdown.indexOf('## Failures and fixes');
      const fixesContentIdx = result.markdown.indexOf(fixes);
      expect(fixesIdx).toBeGreaterThan(-1);
      expect(fixesContentIdx).toBeGreaterThan(fixesIdx);
    });

    it('contains `## Verification` with each command in a fenced code block', () => {
      const cmds = [
        'git diff --cached --quiet',
        'bun test',
        'bun run typecheck',
      ];
      const result = creator.create(
        makeContext({ verificationCommands: cmds })
      );

      expect(result.markdown).toContain('## Verification');
      const verifyIdx = result.markdown.indexOf('## Verification');
      expect(verifyIdx).toBeGreaterThan(-1);

      // Walk the markdown after the heading, asserting each
      // ` ```sh ` block contains the corresponding command.
      let cursor = verifyIdx + '## Verification'.length;
      for (const cmd of cmds) {
        const fenceOpen = result.markdown.indexOf('```sh\n', cursor);
        expect(fenceOpen).toBeGreaterThan(-1);
        const blockStart = fenceOpen + '```sh\n'.length;
        const fenceClose = result.markdown.indexOf('\n```', blockStart);
        expect(fenceClose).toBeGreaterThan(blockStart);
        const blockBody = result.markdown.slice(blockStart, fenceClose);
        expect(blockBody).toContain(cmd);
        cursor = fenceClose + '\n```'.length;
      }
    });
  });

  describe('draft status is pending', () => {
    it('result.skill.status is always "pending" (per DECISIONS.md L67 explicit review)', () => {
      const result = creator.create(makeContext());
      expect(result.skill.status).toBe('pending');
    });

    it('status is "pending" even when an explicit scope is provided', () => {
      const result = creator.create(
        makeContext({ scope: 'project', profileId: 'p-1' })
      );
      expect(result.skill.status).toBe('pending');
    });
  });

  describe('draft source is auto-drafted', () => {
    it('result.skill.source is always "auto-drafted"', () => {
      const result = creator.create(makeContext());
      expect(result.skill.source).toBe('auto-drafted');
    });
  });

  describe('draft provenance captures full context', () => {
    it('provenance contains sessionSummary, toolCallSummary, failuresAndFixes, verificationCommands, draftedAt', () => {
      const ctx = makeContext();
      const result = creator.create(ctx);

      // The provenance is a JSON-compatible object. Each input
      // field is recorded under a `source*` key so the future
      // approval workflow can reconstruct the draft.
      expect(result.skill.provenance.sourceSessionSummary).toBe(
        ctx.sessionSummary
      );
      expect(result.skill.provenance.sourceToolCallSummary).toBe(
        ctx.toolCallSummary
      );
      expect(result.skill.provenance.sourceFailuresAndFixes).toBe(
        ctx.failuresAndFixes
      );
      expect(
        Array.isArray(result.skill.provenance.sourceVerificationCommands)
      ).toBe(true);
      expect(result.skill.provenance.sourceVerificationCommands).toEqual([
        ...ctx.verificationCommands,
      ]);
      // `draftedAt` is an ISO-8601 timestamp string; assert
      // the prefix because the value is `new Date().toISOString()`.
      expect(typeof result.skill.provenance.draftedAt).toBe('string');
      expect(
        String(result.skill.provenance.draftedAt).match(
          /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
        ) !== null
      ).toBe(true);
    });

    it('verificationCommands in provenance is a fresh array (not a reference to the input)', () => {
      // Mutating the input array after `create()` returns must
      // not affect the provenance — the creator should snapshot
      // the commands.
      const cmds = ['echo a', 'echo b'];
      const result = creator.create(
        makeContext({ verificationCommands: cmds })
      );
      const stored = result.skill.provenance.sourceVerificationCommands;
      cmds.push('echo c');
      expect(stored).toEqual(['echo a', 'echo b']);
    });
  });

  describe('description is truncated to 200 chars with ellipsis', () => {
    it('long sessionSummary → description has `...` suffix and length <= 203', () => {
      // Build a summary strictly longer than 200 chars (after
      // trimming). 250 chars of `x` is unambiguous.
      const longSummary = 'x'.repeat(250);
      const result = creator.create(
        makeContext({ sessionSummary: longSummary })
      );

      // Length is bounded: 200 visible chars + 3-char ellipsis.
      expect(result.skill.description.length).toBeLessThanOrEqual(203);
      // Ends with the ellipsis marker.
      expect(result.skill.description.endsWith('...')).toBe(true);
      // The first 200 characters are all `x` (no whitespace at
      // the end, so `trimEnd` is a no-op).
      expect(result.skill.description.slice(0, 200)).toBe('x'.repeat(200));
    });

    it('truncation trims trailing whitespace before appending the ellipsis', () => {
      // 200 `x` chars + trailing whitespace + extra chars.
      // `trimEnd` should drop the whitespace so the visible
      // portion is 200 `x` chars (no space before the `...`).
      const summary = `${'x'.repeat(200)}   ${'y'.repeat(20)}`;
      const result = creator.create(makeContext({ sessionSummary: summary }));
      expect(result.skill.description.endsWith('...')).toBe(true);
      expect(result.skill.description).toBe(`${'x'.repeat(200)}...`);
    });

    it('the Markdown frontmatter description matches the Skill description', () => {
      const longSummary = 'z'.repeat(300);
      const result = creator.create(
        makeContext({ sessionSummary: longSummary })
      );

      const frontmatterEnd = result.markdown.indexOf('---', 4);
      const frontmatter = result.markdown.slice(0, frontmatterEnd + 3);
      expect(frontmatter).toContain(`description: ${result.skill.description}`);
    });
  });

  describe('short description is not truncated', () => {
    it('short sessionSummary → description is the full text, no `...` suffix', () => {
      const summary = 'Short and sweet.';
      const result = creator.create(makeContext({ sessionSummary: summary }));
      expect(result.skill.description).toBe(summary);
      expect(result.skill.description.includes('...')).toBe(false);
    });

    it('200-char summary is the boundary (not truncated)', () => {
      const summary = 'a'.repeat(200);
      const result = creator.create(makeContext({ sessionSummary: summary }));
      // 200 is the boundary; the rule is "longer than 200" → truncate.
      expect(result.skill.description).toBe(summary);
      expect(result.skill.description.includes('...')).toBe(false);
    });

    it('trims surrounding whitespace from the short description', () => {
      const summary = '   trimmed summary   ';
      const result = creator.create(makeContext({ sessionSummary: summary }));
      expect(result.skill.description).toBe('trimmed summary');
    });
  });

  describe('default scope and profileId', () => {
    it('context without `scope` → skill.scope === "user"', () => {
      const result = creator.create(makeContext());
      expect(result.skill.scope).toBe('user');
    });

    it('context without `profileId` → skill.profileId === null', () => {
      const result = creator.create(makeContext());
      expect(result.skill.profileId).toBeNull();
    });

    it('explicit `scope: "project"` overrides the default', () => {
      const result = creator.create(
        makeContext({ scope: 'project', profileId: 'profile-7' })
      );
      expect(result.skill.scope).toBe('project');
      expect(result.skill.profileId).toBe('profile-7');
    });

    it('explicit `profileId: null` is preserved (no override needed)', () => {
      // The default IS null, but a caller that passes null
      // explicitly should see the same value.
      const result = creator.create(makeContext({ profileId: null }));
      expect(result.skill.profileId).toBeNull();
    });
  });
});
