/**
 * singularity-engine — context reference resolution.
 *
 * Parses @-prefixed references from user messages and resolves them
 * to typed ContextReference objects.
 *
 * No Effect imports. No @opencode-ai/* imports.
 */

export interface ContextReference {
  kind: 'file' | 'session' | 'url' | 'profile' | 'artifact';
  value: string;
  description?: string;
}

const REFERENCE_REGEX = /@(file|session|url|profile|artifact):(\S+)/g;

const TRAILING_PUNCTUATION_REGEX = /[.,;:!?]+$/;

const KIND_LABELS: Record<ContextReference['kind'], string> = {
  file: 'file',
  session: 'session',
  url: 'URL',
  profile: 'profile',
  artifact: 'artifact',
};

/**
 * Extract all @-prefixed references from text.
 *
 * Supported formats:
 *   @file:path/to/file
 *   @session:sess_abc123
 *   @url:https://example.com
 *   @profile:default
 *   @artifact:art_xyz789
 *
 * Trailing punctuation (.,;:!?) is stripped from values.
 * URLs must start with http:// or https://.
 */
export function resolveReferences(text: string): ContextReference[] {
  const references: ContextReference[] = [];
  let match: RegExpExecArray | null;

  REFERENCE_REGEX.lastIndex = 0;

  while (true) {
    match = REFERENCE_REGEX.exec(text);
    if (match === null) break;
    const kind = match[1] as ContextReference['kind'];
    let value = match[2];

    // Strip trailing punctuation
    value = value.replace(TRAILING_PUNCTUATION_REGEX, '');

    // Validate URLs
    if (
      kind === 'url' &&
      !value.startsWith('http://') &&
      !value.startsWith('https://')
    ) {
      continue;
    }

    references.push({
      kind,
      value,
      description: `${KIND_LABELS[kind]}: ${value}`,
    });
  }

  return references;
}
