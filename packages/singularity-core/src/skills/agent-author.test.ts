// Phase 11 — `AgentSkillAuthor` unit tests.
//
// The five `describe(...)` blocks cover the public contract of
// `AgentSkillAuthor`:
//
//   1. "draftSkill calls LLM and parses output"      → full round-trip
//   2. "draftSkill validates required fields"         → name, description, whenToUse
//   3. "parseDraft extracts frontmatter fields"       → frontmatter parsing
//   4. "validateDraft throws for missing fields"     → validation errors
//   5. "Non-Markdown LLM output is handled gracefully" → partial parse, validation fails

import { beforeEach, describe, expect, it } from 'bun:test';

import type {
  AgentSkillAuthorInput,
  AgentSkillAuthorOptions,
  AgentSkillDraftResult,
} from './agent-author.ts';
import { AgentSkillAuthor } from './agent-author.ts';

// A minimal mock LLM that returns a pre-configured Markdown string.
function makeMockLlm(output: string): AgentSkillAuthorOptions['llm'] {
  return {
    async *chat(_messages) {
      yield { type: 'text', text: output };
    },
  };
}

// A valid skill Markdown output from the LLM.
const VALID_MARKDOWN = `---
name: git/commit-msg
description: Draft commit messages from staged diffs using conventional commits
---

## When to use

Use this skill when you need to create a commit message from a staged diff.

## Implementation

Call \`git diff --cached\` to get the staged changes, then parse the diff
and generate a conventional commit header + body.

## Failures and fixes

First pass dropped the index line. Fixed by anchoring the parser on \`diff --git\`.

## Verification

\`\`\`sh
git diff --cached --quiet
\`\`\`
\`\`\`sh
bun test
\`\`\`
`;

describe('AgentSkillAuthor', () => {
  let author: AgentSkillAuthor;

  beforeEach(() => {
    author = new AgentSkillAuthor({
      llm: makeMockLlm(VALID_MARKDOWN),
      model: 'test-model',
    });
  });

  describe('draftSkill calls LLM and parses output', () => {
    it('returns a valid AgentSkillDraftResult', async () => {
      const result = await author.draftSkill({
        goal: 'Create a git commit message skill',
      });

      expect(result.name).toBe('git/commit-msg');
      expect(result.description).toBe(
        'Draft commit messages from staged diffs using conventional commits'
      );
      expect(result.whenToUse).toContain('Use this skill when you need');
      expect(result.implementation).toContain('git diff --cached');
      expect(result.failuresAndFixes).toContain('index line');
      expect(result.verificationCommands).toContain(
        'git diff --cached --quiet'
      );
    });

    it('provenance records draftedBy: agent and model', async () => {
      const result = await author.draftSkill({
        goal: 'Test provenance',
      });

      expect(result.provenance.draftedBy).toBe('agent');
      expect(result.provenance.model).toBe('test-model');
      expect(typeof result.provenance.draftedAt).toBe('number');
    });

    it('provenance captures the full input', async () => {
      const input: AgentSkillAuthorInput = {
        goal: 'Test goal',
        sessionHistory: 'Test session',
        toolCalls: [
          { tool: 'Bash', args: { cmd: 'git commit' }, result: 'ok' },
        ],
        failuresAndFixes: 'Fixed X by doing Y',
        skillExamples: ['---name: example---'],
      };

      const result = await author.draftSkill(input);

      expect(result.provenance.input.goal).toBe('Test goal');
      expect(result.provenance.input.sessionHistory).toBe('Test session');
      expect(result.provenance.input.toolCalls).toHaveLength(1);
      expect(result.provenance.input.failuresAndFixes).toBe(
        'Fixed X by doing Y'
      );
      expect(result.provenance.input.skillExamples).toHaveLength(1);
    });
  });

  describe('draftSkill validates required fields', () => {
    it('throws when name is missing from frontmatter', async () => {
      const badMarkdown = `---
description: Has a description but no name
---

## When to use

Something.

## Implementation

Something.

## Verification

\`\`\`sh
echo done
\`\`\`
`;
      const authorBad = new AgentSkillAuthor({
        llm: makeMockLlm(badMarkdown),
        model: 'test-model',
      });

      await expect(authorBad.draftSkill({ goal: 'Test' })).rejects.toThrow(
        /missing required fields/
      );
    });

    it('throws when description is missing from frontmatter', async () => {
      const badMarkdown = `---
name: test/skill
---

## When to use

Something.

## Implementation

Something.

## Verification

\`\`\`sh
echo done
\`\`\`
`;
      const authorBad = new AgentSkillAuthor({
        llm: makeMockLlm(badMarkdown),
        model: 'test-model',
      });

      await expect(authorBad.draftSkill({ goal: 'Test' })).rejects.toThrow(
        /missing required fields/
      );
    });

    it('throws when whenToUse section is missing', async () => {
      const badMarkdown = `---
name: test/skill
description: A test skill
---

## Implementation

Something.

## Verification

\`\`\`sh
echo done
\`\`\`
`;
      const authorBad = new AgentSkillAuthor({
        llm: makeMockLlm(badMarkdown),
        model: 'test-model',
      });

      await expect(authorBad.draftSkill({ goal: 'Test' })).rejects.toThrow(
        /missing required fields/
      );
    });

    it('throws when implementation section is missing', async () => {
      const badMarkdown = `---
name: test/skill
description: A test skill
---

## When to use

Something.

## Verification

\`\`\`sh
echo done
\`\`\`
`;
      const authorBad = new AgentSkillAuthor({
        llm: makeMockLlm(badMarkdown),
        model: 'test-model',
      });

      await expect(authorBad.draftSkill({ goal: 'Test' })).rejects.toThrow(
        /missing required fields/
      );
    });

    it('throws when verificationCommands is empty', async () => {
      const badMarkdown = `---
name: test/skill
description: A test skill
---

## When to use

Something.

## Implementation

Something.

## Verification

`;
      const authorBad = new AgentSkillAuthor({
        llm: makeMockLlm(badMarkdown),
        model: 'test-model',
      });

      await expect(authorBad.draftSkill({ goal: 'Test' })).rejects.toThrow(
        /missing required fields/
      );
    });
  });

  describe('parseDraft extracts frontmatter fields', () => {
    it('extracts name and description from frontmatter', () => {
      const partial = author.parseDraft(VALID_MARKDOWN);

      expect(partial.name).toBe('git/commit-msg');
      expect(partial.description).toBe(
        'Draft commit messages from staged diffs using conventional commits'
      );
    });

    it('extracts When to use section content', () => {
      const partial = author.parseDraft(VALID_MARKDOWN);

      expect(partial.whenToUse).toContain('Use this skill when you need');
    });

    it('extracts Implementation section content', () => {
      const partial = author.parseDraft(VALID_MARKDOWN);

      expect(partial.implementation).toContain('git diff --cached');
    });

    it('extracts Failures and fixes section content', () => {
      const partial = author.parseDraft(VALID_MARKDOWN);

      expect(partial.failuresAndFixes).toContain('index line');
    });

    it('extracts verification commands from fenced code blocks', () => {
      const partial = author.parseDraft(VALID_MARKDOWN);

      expect(partial.verificationCommands).toContain(
        'git diff --cached --quiet'
      );
      expect(partial.verificationCommands).toContain('bun test');
    });

    it('handles frontmatter with no fields gracefully', () => {
      const partial = author.parseDraft('No frontmatter here');

      expect(partial.name).toBe('');
      expect(partial.description).toBe('');
    });

    it('handles missing sections gracefully', () => {
      const minimal = `---
name: minimal/skill
description: Minimal example
---
`;
      const partial = author.parseDraft(minimal);

      expect(partial.name).toBe('minimal/skill');
      expect(partial.description).toBe('Minimal example');
      expect(partial.whenToUse).toBeUndefined();
      expect(partial.implementation).toBeUndefined();
    });
  });

  describe('validateDraft throws for missing required fields', () => {
    it('throws with descriptive error listing all missing fields', () => {
      const partial: Partial<AgentSkillDraftResult> = {
        name: '',
        description: 'Has description',
      };

      expect(() => author.validateDraft(partial, { goal: 'test' })).toThrow(
        /missing required fields: name/
      );
    });

    it('throws for empty name even if description is present', () => {
      const partial: Partial<AgentSkillDraftResult> = {
        name: '   ',
        description: 'Valid description',
        whenToUse: 'Valid',
        implementation: 'Valid',
        verificationCommands: 'Valid',
      };

      expect(() => author.validateDraft(partial, { goal: 'test' })).toThrow(
        /missing required fields: name/
      );
    });

    it('returns a valid AgentSkillDraftResult when all fields present', () => {
      const partial: Partial<AgentSkillDraftResult> = {
        name: 'valid/skill',
        description: 'A valid skill',
        whenToUse: 'Use when needed',
        implementation: 'Implementation details',
        failuresAndFixes: 'Common fixes',
        verificationCommands: 'bun test',
      };

      const result = author.validateDraft(partial, { goal: 'test' });

      expect(result.name).toBe('valid/skill');
      expect(result.description).toBe('A valid skill');
      expect(result.provenance.draftedBy).toBe('agent');
    });

    it('trims whitespace from fields during validation', () => {
      const partial: Partial<AgentSkillDraftResult> = {
        name: '  valid/skill  ',
        description: '  A valid skill  ',
        whenToUse: '  Use when needed  ',
        implementation: '  Implementation details  ',
        failuresAndFixes: '  Common fixes  ',
        verificationCommands: '  bun test  ',
      };

      const result = author.validateDraft(partial, { goal: 'test' });

      expect(result.name).toBe('valid/skill');
      expect(result.description).toBe('A valid skill');
      expect(result.whenToUse).toBe('Use when needed');
    });
  });

  describe('Non-Markdown LLM output is handled gracefully', () => {
    it('parseDraft returns partial data for plain text output', () => {
      const plainText =
        'This is just plain text without any markdown structure.';

      const partial = author.parseDraft(plainText);

      // Frontmatter parsing fails, so name/description are empty
      expect(partial.name).toBe('');
      expect(partial.description).toBe('');
      // Sections are not found
      expect(partial.whenToUse).toBeUndefined();
      expect(partial.implementation).toBeUndefined();
    });

    it('validateDraft throws after parseDraft with incomplete data', () => {
      const plainText =
        'This is just plain text without any markdown structure.';

      const partial = author.parseDraft(plainText);

      // parseDraft returned partial data, validation should fail
      expect(() => author.validateDraft(partial, { goal: 'test' })).toThrow(
        /missing required fields/
      );
    });

    it('parseDraft handles malformed YAML frontmatter gracefully', () => {
      const malformed = `---
name: valid/skill
description: Valid description
invalid yaml: [unclosed array
---

## When to use

Something.

## Implementation

Something.

## Verification

\`\`\`sh
echo done
\`\`\`
`;

      const partial = author.parseDraft(malformed);

      // Should still extract the valid frontmatter fields
      expect(partial.name).toBe('valid/skill');
      expect(partial.description).toBe('Valid description');
    });

    it('parseDraft handles markdown with extra whitespace in sections', () => {
      const messy = `---
name: messy/skill
description: Messy skill
---

##  When to use

Use this.

##     Implementation

Do this.

## Failures and fixes

Fixes.

## Verification

\`\`\`sh
echo test
\`\`\`
`;
      const partial = author.parseDraft(messy);

      expect(partial.name).toBe('messy/skill');
      expect(partial.whenToUse).toBe('Use this.');
      expect(partial.implementation).toBe('Do this.');
    });
  });
});
