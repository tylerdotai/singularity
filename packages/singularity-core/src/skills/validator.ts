// Phase 3.2 — `SkillValidator`: content-level validator for skill Markdown.
//
// Responsibilities:
//   - Parse the YAML-like frontmatter block (delimited by `---` lines)
//     and produce a flat `key → value` map. The parser is intentionally
//     minimal: only single-line `key: value` pairs, no lists, no
//     multi-line scalars, no nested mappings. Adding those requires a
//     real YAML library, which is out of scope (see Decision 1 below).
//   - Parse body sections by `## Heading` markers, returning a map of
//     normalized heading name → content. Names are lowercased and
//     trimmed for matching against the rule's required sections.
//   - Extract Markdown link targets (`[text](path)`) for the
//     `linked-files-scoped` rule.
//   - Detect common secret patterns in the body for the `no-secrets` rule.
//   - Run all 6 rules and return a `ValidationResult` with all issues
//     (no short-circuit on first failure — see Decision 3 below).
//
// Out of scope for this phase:
//   - Integration with `SkillRegistry.approve()` (Phase 7 or dedicated
//     integration task). The validator is a pure, standalone function
//     over Markdown strings.
//   - DB-backed `skills` table (Phase 4 follow-up per `ARCHITECTURE.md`)
//   - Line numbers in `ValidationIssue.location` (would require a full
//     parser; future phase can add them).
//   - Network-based secret detection (GitGuardian etc.). The regex
//     patterns cover common formats; edge cases are out of scope.
//
// Design decisions (mirror the plan's "Key Design Decisions" section):
//   1. No YAML library — frontmatter is simple `key: value` pairs.
//   2. No markdown parser library — section detection via `^## ` regex;
//      link extraction via `\[text\]\(path\)` regex.
//   3. All rules always run — issues are accumulated; no short-circuit.
//   4. `valid` is `issues.length === 0` — single source of truth.
//   5. Issues are ordered — frontmatter rules first, then body rules,
//      then links. Output is predictable for test assertions.
//   6. The `location` field is optional — Phase 3.2 does not emit it.
//   7. Secret detection is regex-based — best-effort, not exhaustive.
//   8. The validator does NOT modify `SkillRegistry` — standalone.
//
// Note on path normalization: the plan recommends `import { posix }
// from 'node:path'`, but singularity-core deliberately does not pull
// in `@types/node` (the package's type surface is hand-declared in
// `bun-globals.d.ts`). The validator's link-scoping rule needs only
// two POSIX operations (normalize + join with `/` separator), so a
// small inline helper is used instead. The semantics match `posix`
// for the cases the rule actually exercises: collapse duplicate `/`,
// resolve `.` and `..` segments, no special root handling.

/**
 * A single validation issue — one per failed rule.
 *
 * The `rule` field is a stable identifier (e.g., `"name-required"`,
 * `"no-secrets"`, `"linked-files-scoped"`) suitable for machine
 * filtering. The `message` is a human-readable description. The
 * optional `location` is reserved for future line-number reporting
 * (Phase 3.2 does not emit it).
 */
export interface ValidationIssue {
  readonly rule: string;
  readonly message: string;
  readonly location?: string;
}

/**
 * The result of a `validate()` call. `valid` is `true` iff
 * `issues.length === 0` — a single source of truth for validity.
 * The `issues` array is the ordered concatenation of all per-rule
 * findings (frontmatter rules first, then body, then links).
 */
export interface ValidationResult {
  readonly valid: boolean;
  readonly issues: readonly ValidationIssue[];
}

/**
 * Options for `validate()`. The `skillDir` is the absolute filesystem
 * path to the skill's directory, used by the `linked-files-scoped`
 * rule to resolve relative link paths and check they stay under the
 * skill root.
 */
export interface ValidateOptions {
  readonly skillDir: string;
}

/**
 * Section heading regex — matches a `##` line and captures the heading
 * text. Anchored to start of line; the heading is captured up to the
 * end of the line. Case is handled by lowercasing the captured group
 * after the match, not by the regex itself.
 */
const SECTION_HEADER_RE = /^##\s+(.+?)\s*$/gm;

/**
 * Markdown link regex — global, matches `[text](target)` and captures
 * the target inside the parentheses. Anchored to find ALL links in
 * the content, not just the first.
 */
const LINK_RE = /\[([^\]]*)\]\(([^)]+)\)/g;

/**
 * Secret detection patterns. Best-effort, not exhaustive. Patterns
 * cover common formats; the caller (a future approval workflow) is
 * expected to surface them and let a human decide.
 */
const SECRET_PATTERNS: readonly RegExp[] = [
  // api_key / api-key / apikey + ":" or "=" + 16+ alphanumeric chars
  /(?:api[_-]?key|access[_-]?token|auth[_-]?token)\s*[:=]\s*['"]?[A-Za-z0-9_-]{16,}/i,
  // password / passwd / pwd + ":" or "=" + 8+ non-whitespace chars
  /(?:password|passwd|pwd)\s*[:=]\s*['"]?[^\s'"]{8,}/i,
  // secret / private_key / private-key + ":" or "=" + 16+ alphanumeric chars
  /(?:secret|private[_-]?key)\s*[:=]\s*['"]?[A-Za-z0-9_-]{16,}/i,
  // PEM private key header
  /-----BEGIN [A-Z ]+PRIVATE KEY-----/,
];

/**
 * URL prefix patterns — links that start with these are treated as
 * external references and skipped by the `linked-files-scoped` rule.
 */
const URL_PREFIXES: readonly string[] = ['http://', 'https://', 'mailto:'];

/**
 * Pure, content-level validator for skill Markdown.
 *
 * Usage:
 * ```ts
 * const v = new SkillValidator();
 * const result = v.validate(skillMarkdown, { skillDir: '/abs/path/to/skill' });
 * if (!result.valid) {
 *   for (const issue of result.issues) console.log(issue.rule, issue.message);
 * }
 * ```
 *
 * The class is stateless — every `validate()` call is independent.
 * Instances are cheap to construct; the class is held as a class
 * (not a free function) so the future approval workflow can inject
 * a different configuration (e.g., extra secret patterns) without
 * changing call sites.
 */
export class SkillValidator {
  /**
   * Validate a skill's Markdown content. Runs all 6 rules and
   * returns the accumulated issues. The order is deterministic:
   * frontmatter rules (`name-required`, `description-required`),
   * then body section rules (`trigger-section-required`,
   * `verification-section-required`), then body content rules
   * (`no-secrets`), then link rules (`linked-files-scoped`).
   */
  validate(content: string, options: ValidateOptions): ValidationResult {
    const issues: ValidationIssue[] = [];
    const frontmatter = this.parseFrontmatter(content);
    const bodySections = this.parseBodySections(content);

    // Frontmatter rules.
    if (frontmatter.name === undefined || frontmatter.name.trim() === '') {
      issues.push({
        rule: 'name-required',
        message: 'frontmatter must have a non-empty `name` field',
      });
    }
    if (
      frontmatter.description === undefined ||
      frontmatter.description.trim() === ''
    ) {
      issues.push({
        rule: 'description-required',
        message: 'frontmatter must have a non-empty `description` field',
      });
    }

    // Body section rules.
    if (!this.hasTriggerSection(bodySections)) {
      issues.push({
        rule: 'trigger-section-required',
        message: 'body must have a `## When to use` or `## Trigger` section',
      });
    }
    if (!this.hasVerificationSection(bodySections)) {
      issues.push({
        rule: 'verification-section-required',
        message: 'body must have a `## Verification` section',
      });
    }

    // Body content rules — secrets.
    if (this.hasSecretPattern(content)) {
      issues.push({
        rule: 'no-secrets',
        message:
          'body must not contain secret patterns (api keys, tokens, passwords)',
      });
    }

    // Link rules.
    const links = this.extractLinks(content);
    for (const link of links) {
      if (!this.isLinkScoped(link, options.skillDir)) {
        issues.push({
          rule: 'linked-files-scoped',
          message: `linked file "${link}" must be a relative path under the skill directory`,
        });
      }
    }

    return {
      valid: issues.length === 0,
      issues,
    };
  }

  /**
   * Parse frontmatter from Markdown content.
   *
   * The frontmatter is delimited by `---` on its own line at the
   * start of the content. Between the markers, each non-empty,
   * non-comment line is parsed as `key: value`. Whitespace is
   * trimmed from both sides.
   *
   * Edge cases:
   *   - No opening `---` → empty record.
   *   - Opening `---` with no closing `---` → empty record (the
   *     content is treated as a body, not a malformed frontmatter).
   *   - `name: ` (empty value) → record entry with empty string;
   *     the rules check for non-empty after trim.
   */
  private parseFrontmatter(content: string): Record<string, string> {
    const result: Record<string, string> = {};

    // Normalize line endings for the leading-delimiter check, but
    // preserve the original content for the body split (frontmatter
    // lines are split on `\n` and tolerate `\r` in values).
    if (!content.startsWith('---\n') && !content.startsWith('---\r\n')) {
      return result;
    }

    // Find the closing `---` line. Start scanning after the opening
    // `---` + newline. The closing delimiter must be on its own line.
    const afterOpen = content.startsWith('---\r\n')
      ? '---\r\n'.length
      : '---\n'.length;
    const body = content.slice(afterOpen);

    const lines = body.split(/\r?\n/);
    const collected: string[] = [];
    let foundClose = false;
    for (const line of lines) {
      if (line === '---' || line === '...') {
        foundClose = true;
        break;
      }
      collected.push(line);
    }

    if (!foundClose) {
      return result;
    }

    for (const line of collected) {
      const trimmed = line.trim();
      if (trimmed === '' || trimmed.startsWith('#')) {
        continue;
      }
      const colonIdx = trimmed.indexOf(':');
      if (colonIdx === -1) {
        continue;
      }
      const key = trimmed.slice(0, colonIdx).trim();
      const value = trimmed.slice(colonIdx + 1).trim();
      // Strip surrounding quotes if present.
      const unquoted =
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
          ? value.slice(1, -1)
          : value;
      result[key] = unquoted;
    }

    return result;
  }

  /**
   * Parse body sections. Returns a map of normalized section name
   * (lowercase, trimmed, spaces collapsed) → section content.
   *
   * The content passed in is the FULL markdown (including frontmatter).
   * The parser splits on `^##\s+(.+)$` and treats everything before
   * the first `##` as preamble (not a section). Section content runs
   * from the end of the heading line to the start of the next `##`
   * heading or the end of the content.
   */
  private parseBodySections(content: string): Map<string, string> {
    const sections = new Map<string, string>();

    // Strip the frontmatter if present — section headers inside the
    // frontmatter block (none expected) should not leak in. We do
    // this by finding the closing `---` and starting the section
    // scan from after it.
    const bodyStart = this.findBodyStart(content);
    const body = content.slice(bodyStart);

    // Collect all `##` heading positions. Each entry records the
    // heading's `match.index` (the start of `##`) and `match[0]`
    // length (the raw heading line, used to advance past it).
    const headings: { name: string; matchIndex: number; lineLength: number }[] =
      [];
    // `matchAll` returns an iterator of full match results; each
    // element is a `RegExpExecArray` with `index`, `0`, and capture
    // groups. The regex must have the `g` flag (it does).
    const sectionRegex = new RegExp(SECTION_HEADER_RE.source, 'gm');
    for (const match of body.matchAll(sectionRegex)) {
      // `match[1]` is the heading text. Normalize: lowercase + trim.
      const raw = match[1] ?? '';
      const normalized = raw.toLowerCase().trim().replace(/\s+/g, ' ');
      // `match[0].length` is the raw heading line length, NOT
      // including the trailing newline. The next byte after the
      // match (assuming a newline follows) is the start of the
      // section content.
      headings.push({
        name: normalized,
        matchIndex: match.index,
        lineLength: match[0].length,
      });
    }

    for (let i = 0; i < headings.length; i++) {
      const current = headings[i];
      if (current === undefined) continue;
      const next = headings[i + 1];
      // The section content starts after the heading line + the
      // trailing newline (1 char). The trailing newline is the
      // `m`-flag `$` boundary — in most files it's `\n`.
      const contentStart = current.matchIndex + current.lineLength + 1;
      const contentEnd = next !== undefined ? next.matchIndex : body.length;
      const sectionContent = body.slice(contentStart, contentEnd).trim();
      sections.set(current.name, sectionContent);
    }

    return sections;
  }

  /**
   * Extract Markdown link targets from content. Matches `[text](path)`
   * globally and returns just the `path` portion (the contents inside
   * the parentheses). URLs and anchors are still extracted at this
   * stage — the `linked-files-scoped` rule filters them out.
   */
  private extractLinks(content: string): string[] {
    const links: string[] = [];
    const linkRegex = new RegExp(LINK_RE.source, 'g');
    for (const match of content.matchAll(linkRegex)) {
      links.push(match[2] ?? '');
    }
    return links;
  }

  /**
   * Check whether the content contains any of the secret patterns.
   * Returns `true` on the first match; the caller doesn't need to
   * know which pattern fired (or where) for Phase 3.2.
   */
  private hasSecretPattern(content: string): boolean {
    for (const pattern of SECRET_PATTERNS) {
      if (pattern.test(content)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Check whether a Markdown link target is scoped under the skill
   * directory.
   *
   * Rules:
   *   - URLs (`http://`, `https://`, `mailto:`) and anchors (start
   *     with `#`) are always considered scoped — they don't
   *     reference local files.
   *   - Empty targets are rejected (no link target is not a valid
   *     file reference).
   *   - Absolute paths (start with `/`) are rejected — they are
   *     treated as outside the skill directory by default.
   *   - Paths starting with `..` are rejected — parent traversal
   *     is forbidden.
   *   - All other paths are resolved against `skillDir` using
   *     POSIX semantics (so `/` is always the separator regardless
   *     of host OS) and checked for escape.
   */
  private isLinkScoped(link: string, skillDir: string): boolean {
    const target = link.trim();
    if (target === '') {
      return false;
    }
    // Anchor — always in-scope (refers to a heading in the same file).
    if (target.startsWith('#')) {
      return true;
    }
    // External URL or mailto — always in-scope.
    for (const prefix of URL_PREFIXES) {
      if (target.startsWith(prefix)) {
        return true;
      }
    }
    // Absolute path (POSIX-style `/` or Windows-style `C:\`) — out of scope.
    if (target.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(target)) {
      return false;
    }
    // Parent traversal — out of scope.
    if (target.startsWith('..')) {
      return false;
    }
    // Normalize the link: collapse any leading `./` so the resolved
    // path doesn't start with a `.` segment.
    const normalizedLink = target.startsWith('./') ? target.slice(2) : target;
    // Normalize `skillDir` to a POSIX-style absolute path. The
    // inline helper ensures the separators are `/` and collapses
    // `..` / `.` segments — same semantics as `posix.normalize`.
    const normalizedSkillDir = posixNormalize(skillDir);
    // Resolve the link against the skill dir. Joining is a literal
    // `/` insertion because the link is already relative.
    const resolved = posixNormalize(`${normalizedSkillDir}/${normalizedLink}`);
    // The resolved path must start with the skill dir + `/` to be
    // considered under it (the trailing `/` prevents prefix matches
    // like `/skills/foo` matching `/skills/foobar`).
    return (
      resolved === normalizedSkillDir ||
      resolved.startsWith(`${normalizedSkillDir}/`)
    );
  }

  // --- Per-rule predicates (private). One per rule for clarity. ---

  /**
   * `trigger-section-required`: the body must have a section whose
   * normalized name is `when to use` or `trigger`. Comparison is
   * case-insensitive (handled by the section name normalization).
   */
  private hasTriggerSection(sections: Map<string, string>): boolean {
    for (const name of sections.keys()) {
      if (name === 'when to use' || name === 'trigger') {
        return true;
      }
    }
    return false;
  }

  /**
   * `verification-section-required`: the body must have a section
   * whose normalized name is `verification`.
   */
  private hasVerificationSection(sections: Map<string, string>): boolean {
    return sections.has('verification');
  }

  // --- Helpers ---

  /**
   * Find the start of the body — i.e., the character index just after
   * the closing `---` of the frontmatter. If no frontmatter is present,
   * the body starts at index 0.
   */
  private findBodyStart(content: string): number {
    const opensLf = content.startsWith('---\n');
    const opensCrlf = !opensLf && content.startsWith('---\r\n');
    if (!opensLf && !opensCrlf) {
      return 0;
    }
    // Skip the opening delimiter: 4 bytes for `---\n` or 5 for `---\r\n`.
    const skipOpen = opensCrlf ? 5 : 4;
    const body = content.slice(skipOpen);
    const lines = body.split(/\r?\n/);
    let offset = skipOpen;
    for (const line of lines) {
      if (line === '---' || line === '...') {
        // Skip the closing `---` line and its trailing newline.
        offset += line.length;
        if (content[offset] === '\r') offset++;
        if (content[offset] === '\n') offset++;
        return offset;
      }
      offset += line.length + 1; // +1 for the newline the split dropped
    }
    // No closing delimiter found — treat the whole content as body.
    return 0;
  }
}

// Module-scope POSIX path normalizer.
//
// Mirrors the subset of `posix.normalize` semantics the validator's
// `isLinkScoped` rule needs: split on `/`, discard empty segments
// (collapses duplicate `/`), discard `.` segments, resolve `..` by
// popping the previous segment (or keeping `..` if at the start).
// No special handling for absolute-root `/` — the validator's callers
// pass an absolute `skillDir` and the link-scoping check uses
// `startsWith` against it, so the only requirement is that the
// separator be `/` (POSIX) regardless of host OS.
//
// Exported (named, not default) so tests can exercise it directly.
export function posixNormalize(path: string): string {
  if (path === '') return '.';
  const isAbsolute = path.startsWith('/');
  const parts = path.split('/').filter((segment) => segment !== '');
  const out: string[] = [];
  for (const part of parts) {
    if (part === '.') continue;
    if (part === '..') {
      // Pop the last segment unless it's also `..` or the start.
      const last = out[out.length - 1];
      if (last !== undefined && last !== '..') {
        out.pop();
      } else if (!isAbsolute) {
        out.push('..');
      }
      // Absolute path: `..` at the root is dropped silently.
      continue;
    }
    out.push(part);
  }
  const prefix = isAbsolute ? '/' : '';
  return out.length === 0 ? prefix || '.' : `${prefix}${out.join('/')}`;
}
