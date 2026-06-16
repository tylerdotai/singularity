// Phase 6.1 — shared profile error types.
//
// Two error classes + one reason discriminator live here so the store
// (`store.ts`) and the resolver (`resolver.ts`) can both throw them
// without introducing a circular import. The pattern mirrors how
// `WorktreeError` in `src/workspace/worktree.ts` and `LLMUnreachableError`
// in `src/memory/embedding-adapter.ts` are declared: `readonly` fields
// captured on the error instance, `this.name = '<ClassName>'` for
// `instanceof` fallback, `super(<message>)` for the human-readable form.
//
// Why a single file:
//   The store's `create()` validates the name; the resolver's
//   `resolve(name)` validates the same name. Both throw the same
//   `ProfileNameError` so callers can switch on a single error type.
//   `setDefaultAgent(id)` / `delete(id)` (store) and `resolve(name)`
//   (resolver) all need `ProfileNotFoundError`. A shared module keeps
//   the discriminator values (`ProfileNameReason`) in one place.
//
// `ProfileNotFoundError` accepts either `name` (resolver path) or
// `id` (store path) via an options bag so the same class covers both
// "the named profile does not exist" and "the row for this id has
// been deleted" failure modes.

/**
 * Discriminator for `ProfileNameError`. Callers should pattern-match
 * on the `reason` field (string literal union) before reading the
 * message — the human-readable text is for logs only.
 */
export type ProfileNameReason =
  | 'empty'
  | 'too_long'
  | 'path_traversal'
  | 'invalid_characters';

/**
 * Thrown when a profile name fails validation. The `reason` field is
 * one of the four `ProfileNameReason` values; the constructor also
 * stores the offending `profileName` for callers that want to surface
 * it back to the user (e.g. a future CLI `singularity profile create`).
 */
export class ProfileNameError extends Error {
  readonly profileName: string;
  readonly reason: ProfileNameReason;

  constructor(profileName: string, reason: ProfileNameReason) {
    super(`invalid profile name: ${profileName} (${reason})`);
    this.name = 'ProfileNameError';
    this.profileName = profileName;
    this.reason = reason;
  }
}

/**
 * Thrown when a profile cannot be found. Accepts either `name` (the
 * resolver path: `<profileRoot>/<name>` does not exist) or `id` (the
 * store path: the row for `<id>` was not present, e.g. the row was
 * deleted between an earlier `getById` and a later `setDefaultAgent`).
 * At least one identifier is recommended; the message falls back to
 * `<unknown>` if neither is supplied.
 */
export class ProfileNotFoundError extends Error {
  readonly profileName?: string;
  readonly profileId?: string;

  constructor(options: { name?: string; id?: string } = {}) {
    const label = options.id ?? options.name ?? '<unknown>';
    super(`profile not found: ${label}`);
    this.name = 'ProfileNotFoundError';
    this.profileName = options.name;
    this.profileId = options.id;
  }
}
