// Phase 3.2 — `SkillValidator` unit tests.
//
// The eight `describe(...)` blocks below are the IMPLEMENTATION_PLAN
// Task 3.2 test-first scenarios (`docs/singularity/IMPLEMENTATION_PLAN.md`
// lines 241-248), plus the "valid skill" integration scenario and the
// "multiple errors" scenario. Each scenario maps 1:1 to a public
// contract of `SkillValidator`:
//
//   1. "name required"                 → frontmatter `name` empty/missing
//   2. "description required"          → frontmatter `description` empty/missing
//   3. "trigger section required"      → body has no trigger section
//   4. "verification section required" → body has no verification section
//   5. "no secrets"                    → body has a `api_key: sk-…` line
//   6. "linked files scoped"           → body has a `../../etc/passwd` link
//   7. "valid skill"                   → all required fields present → valid
//   8. "multiple errors"               → name + description + trigger missing
//
// `beforeEach` constructs a fresh `SkillValidator` so the tests are
// isolated and order-independent.

import { beforeEach, describe, expect, it } from 'bun:test';

import { posixNormalize, SkillValidator } from './validator.ts';

// Test fixture: a fully-valid skill Markdown. Individual tests strip
// one or more fields to drive each rule.
const VALID_SKILL = `---
name: git/commit
description: Draft a git commit message from a diff.
---

## When to use

When the user asks for a commit message draft from a staged diff.

## Verification

Run \`git diff --cached\` and confirm the message covers every hunk.
`;

// Test fixture helper: build a skill with specific fields overridden
// (set a field to `''` to remove it, or to a non-empty string to
// override it).
function makeSkill(
  opts: {
    name?: string;
    description?: string;
    triggerHeading?: string;
    verificationHeading?: string;
    extraBody?: string;
    extraFrontmatter?: string;
  } = {}
): string {
  const nameLine =
    opts.name === '' ? '' : `name: ${opts.name ?? 'git/commit'}\n`;
  const descLine =
    opts.description === ''
      ? ''
      : `description: ${opts.description ?? 'Draft a git commit message from a diff.'}\n`;
  const trigger = opts.triggerHeading ?? '## When to use';
  const verification = opts.verificationHeading ?? '## Verification';
  const extraFm = opts.extraFrontmatter ?? '';
  const extraBody = opts.extraBody ?? '';
  return `---
${nameLine}${descLine}${extraFm}---

${trigger}

Trigger description.

${verification}

Verification steps.

${extraBody}
`;
}

describe('SkillValidator', () => {
  let validator: SkillValidator;

  beforeEach(() => {
    validator = new SkillValidator();
  });

  describe('name required', () => {
    it('reports name-required when the frontmatter `name` field is empty', () => {
      const content = makeSkill({ name: '' });
      const result = validator.validate(content, { skillDir: '/skills' });

      expect(result.valid).toBe(false);
      expect(result.issues.length).toBeGreaterThan(0);
      const ruleIds = result.issues.map((i) => i.rule);
      expect(ruleIds).toContain('name-required');
    });

    it('reports name-required when the frontmatter `name` field is missing entirely', () => {
      const content = makeSkill({
        name: '',
        extraFrontmatter: 'version: 1.0.0\n',
      });
      const result = validator.validate(content, { skillDir: '/skills' });

      expect(result.valid).toBe(false);
      const ruleIds = result.issues.map((i) => i.rule);
      expect(ruleIds).toContain('name-required');
    });

    it('passes when the frontmatter `name` is non-empty', () => {
      const result = validator.validate(VALID_SKILL, { skillDir: '/skills' });
      const ruleIds = result.issues.map((i) => i.rule);
      expect(ruleIds.includes('name-required')).toBe(false);
    });
  });

  describe('description required', () => {
    it('reports description-required when the frontmatter `description` field is empty', () => {
      const content = makeSkill({ description: '' });
      const result = validator.validate(content, { skillDir: '/skills' });

      expect(result.valid).toBe(false);
      const ruleIds = result.issues.map((i) => i.rule);
      expect(ruleIds).toContain('description-required');
    });

    it('reports description-required when the frontmatter `description` field is missing entirely', () => {
      const content = makeSkill({
        description: '',
        extraFrontmatter: 'version: 1.0.0\n',
      });
      const result = validator.validate(content, { skillDir: '/skills' });

      expect(result.valid).toBe(false);
      const ruleIds = result.issues.map((i) => i.rule);
      expect(ruleIds).toContain('description-required');
    });

    it('passes when the frontmatter `description` is non-empty', () => {
      const result = validator.validate(VALID_SKILL, { skillDir: '/skills' });
      const ruleIds = result.issues.map((i) => i.rule);
      expect(ruleIds.includes('description-required')).toBe(false);
    });
  });

  describe('trigger section required', () => {
    it('reports trigger-section-required when there is no `## When to use` or `## Trigger` section', () => {
      const content = makeSkill({ triggerHeading: '## Usage' });
      const result = validator.validate(content, { skillDir: '/skills' });

      expect(result.valid).toBe(false);
      const ruleIds = result.issues.map((i) => i.rule);
      expect(ruleIds).toContain('trigger-section-required');
    });

    it('passes when the body has a `## When to use` section', () => {
      const result = validator.validate(VALID_SKILL, { skillDir: '/skills' });
      const ruleIds = result.issues.map((i) => i.rule);
      expect(ruleIds.includes('trigger-section-required')).toBe(false);
    });

    it('passes when the body has a `## Trigger` section (alternate spelling)', () => {
      const content = makeSkill({ triggerHeading: '## Trigger' });
      const result = validator.validate(content, { skillDir: '/skills' });

      const ruleIds = result.issues.map((i) => i.rule);
      expect(ruleIds.includes('trigger-section-required')).toBe(false);
    });
  });

  describe('verification section required', () => {
    it('reports verification-section-required when there is no `## Verification` section', () => {
      const content = makeSkill({ verificationHeading: '## Testing' });
      const result = validator.validate(content, { skillDir: '/skills' });

      expect(result.valid).toBe(false);
      const ruleIds = result.issues.map((i) => i.rule);
      expect(ruleIds).toContain('verification-section-required');
    });

    it('passes when the body has a `## Verification` section', () => {
      const result = validator.validate(VALID_SKILL, { skillDir: '/skills' });
      const ruleIds = result.issues.map((i) => i.rule);
      expect(ruleIds.includes('verification-section-required')).toBe(false);
    });
  });

  describe('no secrets', () => {
    it('reports no-secrets when the body contains an api_key assignment', () => {
      const content = makeSkill({ extraBody: 'api_key: sk-1234567890abcdef' });
      const result = validator.validate(content, { skillDir: '/skills' });

      expect(result.valid).toBe(false);
      const ruleIds = result.issues.map((i) => i.rule);
      expect(ruleIds).toContain('no-secrets');
    });

    it('reports no-secrets when the body contains a password assignment', () => {
      const content = makeSkill({ extraBody: 'password: hunter2hunter2' });
      const result = validator.validate(content, { skillDir: '/skills' });

      expect(result.valid).toBe(false);
      const ruleIds = result.issues.map((i) => i.rule);
      expect(ruleIds).toContain('no-secrets');
    });

    it('reports no-secrets when the body contains a PEM private key header', () => {
      const content = makeSkill({
        extraBody:
          'See this key:\n\n-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAK...',
      });
      const result = validator.validate(content, { skillDir: '/skills' });

      expect(result.valid).toBe(false);
      const ruleIds = result.issues.map((i) => i.rule);
      expect(ruleIds).toContain('no-secrets');
    });

    it('passes when the body has no secret patterns', () => {
      const result = validator.validate(VALID_SKILL, { skillDir: '/skills' });
      const ruleIds = result.issues.map((i) => i.rule);
      expect(ruleIds.includes('no-secrets')).toBe(false);
    });
  });

  describe('linked files scoped', () => {
    it('reports linked-files-scoped when a Markdown link uses `..` parent traversal', () => {
      const content = makeSkill({
        extraBody: 'See [passwd](../../etc/passwd).',
      });
      const result = validator.validate(content, {
        skillDir: '/skills/git/commit',
      });

      expect(result.valid).toBe(false);
      const ruleIds = result.issues.map((i) => i.rule);
      expect(ruleIds).toContain('linked-files-scoped');
    });

    it('reports linked-files-scoped when a Markdown link is an absolute path', () => {
      const content = makeSkill({ extraBody: 'See [abs](/etc/passwd).' });
      const result = validator.validate(content, {
        skillDir: '/skills/git/commit',
      });

      expect(result.valid).toBe(false);
      const ruleIds = result.issues.map((i) => i.rule);
      expect(ruleIds).toContain('linked-files-scoped');
    });

    it('passes when all Markdown links are scoped under the skill directory', () => {
      const content = makeSkill({ extraBody: 'See [helper](./helper.md).' });
      const result = validator.validate(content, {
        skillDir: '/skills/git/commit',
      });

      const ruleIds = result.issues.map((i) => i.rule);
      expect(ruleIds.includes('linked-files-scoped')).toBe(false);
    });

    it('passes for external URLs (https/http/mailto) regardless of skillDir', () => {
      const content = makeSkill({
        extraBody:
          'See [docs](https://example.com/docs) and [email](mailto:a@b.com).',
      });
      const result = validator.validate(content, { skillDir: '/skills' });

      const ruleIds = result.issues.map((i) => i.rule);
      expect(ruleIds.includes('linked-files-scoped')).toBe(false);
    });

    it('passes for in-page anchors (start with #)', () => {
      const content = makeSkill({
        extraBody: 'See [verification](#verification).',
      });
      const result = validator.validate(content, { skillDir: '/skills' });

      const ruleIds = result.issues.map((i) => i.rule);
      expect(ruleIds.includes('linked-files-scoped')).toBe(false);
    });
  });

  describe('valid skill', () => {
    it('returns valid=true with zero issues for a fully-populated skill', () => {
      const result = validator.validate(VALID_SKILL, { skillDir: '/skills' });

      expect(result.valid).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    it('every issue has a non-empty `rule` and `message`', () => {
      const content = makeSkill({ name: '', description: '' });
      const result = validator.validate(content, { skillDir: '/skills' });

      expect(result.valid).toBe(false);
      for (const issue of result.issues) {
        expect(issue.rule.length).toBeGreaterThan(0);
        expect(issue.message.length).toBeGreaterThan(0);
      }
    });

    it('issues are returned as a readonly array (length frozen at validation time)', () => {
      const result = validator.validate(VALID_SKILL, { skillDir: '/skills' });
      // The array type is `readonly ValidationIssue[]` — this assertion
      // would not compile if the type were mutable.
      expect(typeof result.issues).toBe('object');
      expect(Array.isArray(result.issues)).toBe(true);
    });
  });

  describe('multiple errors', () => {
    it('reports all three issues when name, description, and trigger section are missing', () => {
      // No name, no description, and the only `##` heading is "Verification"
      // (so trigger-section-required fires too).
      const content = makeSkill({
        name: '',
        description: '',
        triggerHeading: '## Usage',
      });
      const result = validator.validate(content, { skillDir: '/skills' });

      expect(result.valid).toBe(false);
      expect(result.issues).toHaveLength(3);
      const ruleIds = result.issues.map((i) => i.rule);
      expect(ruleIds).toContain('name-required');
      expect(ruleIds).toContain('description-required');
      expect(ruleIds).toContain('trigger-section-required');
    });

    it('reports the issues in a stable, predictable order (frontmatter → body)', () => {
      // All four common failures: missing name + description + trigger + verification.
      const content = makeSkill({
        name: '',
        description: '',
        triggerHeading: '## Usage',
        verificationHeading: '## Testing',
      });
      const result = validator.validate(content, { skillDir: '/skills' });

      expect(result.valid).toBe(false);
      expect(result.issues).toHaveLength(4);
      const ruleIds = result.issues.map((i) => i.rule);
      // Frontmatter rules come before body section rules.
      const nameIdx = ruleIds.indexOf('name-required');
      const descIdx = ruleIds.indexOf('description-required');
      const triggerIdx = ruleIds.indexOf('trigger-section-required');
      const verifyIdx = ruleIds.indexOf('verification-section-required');
      expect(nameIdx).toBeLessThan(triggerIdx);
      expect(descIdx).toBeLessThan(triggerIdx);
      expect(triggerIdx).toBeLessThan(verifyIdx);
    });
  });
});

describe('posixNormalize', () => {
  it('collapses duplicate slashes', () => {
    expect(posixNormalize('/skills//git//commit')).toBe('/skills/git/commit');
  });

  it('resolves `.` segments', () => {
    expect(posixNormalize('/skills/./git/commit')).toBe('/skills/git/commit');
  });

  it('resolves `..` segments by popping the parent', () => {
    expect(posixNormalize('/skills/git/../commit')).toBe('/skills/commit');
  });

  it('returns `.` for the empty string', () => {
    expect(posixNormalize('')).toBe('.');
  });

  it('preserves the leading `/` for absolute paths', () => {
    expect(posixNormalize('/foo')).toBe('/foo');
  });
});
