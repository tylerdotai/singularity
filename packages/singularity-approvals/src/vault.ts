// Phase 4.0 — grant vault interface + in-memory stub.
//
// The vault is the storage layer for `Grant` records. Phase 4.0 ships
// an in-memory stub (`InMemoryGrantVault`) that backs onto a
// `Map<string, Grant>`. Phase 4.2 replaces this with a DB-backed
// implementation that writes to the `approvals` table defined in
// `docs/singularity/ARCHITECTURE.md` lines 152-163.
//
// All methods are async so the future DB-backed implementation can
// use the same surface. The in-memory stub resolves synchronously
// but the signatures preserve the async shape.

import type { Grant, GrantRequest } from "./grant.ts";

// Optional filter for `GrantVault.list()`. All fields are optional;
// an empty filter returns ALL grants (any effect, any session).
//
// Future callers (Phase 7 CLI, Phase 8 gateways) can pass
// `{ effect: "allow" }` to see only allow-grants, or
// `{ sessionId }` to scope to one session.
export interface GrantFilter {
	readonly sessionId?: string;
	readonly action?: string;
	readonly scope?: string;
}

// The grant vault — stores and retrieves grants.
export interface GrantVault {
	// Store a grant. Throws if a grant with the same id already exists.
	store(grant: Grant): Promise<void>;
	// Get a grant by id. Returns `undefined` if no grant with that id.
	get(id: string): Promise<Grant | undefined>;
	// List grants with optional filter.
	list(filter?: GrantFilter): Promise<Grant[]>;
	// Revoke a grant by id. No-op if the grant does not exist.
	revoke(id: string): Promise<void>;
	// Purge expired grants. Returns the number purged.
	purgeExpired(): Promise<number>;
	// Check if a request is covered by a valid (non-expired) grant.
	// Returns the first matching grant if covered, `undefined`
	// otherwise. Matching is by `action` + `resource` (both must
	// match; resource `undefined` matches a request with no resource).
	check(request: GrantRequest): Promise<Grant | undefined>;
}

/**
 * In-memory implementation of `GrantVault`.
 *
 * Storage is a flat `Map<string, Grant>` keyed by `grant.id`. The
 * stub is intentionally minimal — it covers the 6 interface methods
 * with no extra features (no expiration indexing, no scope indexes).
 * Phase 4.2 will replace this with a DB-backed implementation that
 * adds appropriate indexes on the `approvals` table.
 */
export class InMemoryGrantVault implements GrantVault {
	private readonly grants = new Map<string, Grant>();

	/**
	 * Store a grant. Throws if a grant with the same id already
	 * exists. Callers that need upsert semantics should revoke the
	 * old grant first or generate a fresh id.
	 */
	async store(grant: Grant): Promise<void> {
		if (this.grants.has(grant.id)) {
			throw new Error(`grant "${grant.id}" already exists`);
		}
		this.grants.set(grant.id, grant);
	}

	/**
	 * Get a grant by id. Returns `undefined` if no grant with that
	 * id is stored. The returned grant is the live reference; do not
	 * mutate its fields (they are `readonly`).
	 */
	async get(id: string): Promise<Grant | undefined> {
		return this.grants.get(id);
	}

	/**
	 * List grants with optional filter. Filters are AND-combined.
	 * An empty filter returns ALL stored grants (any effect, any
	 * session). Grants whose `expiresAt` is in the past are still
	 * returned by `list()` — use `check()` for expiration-aware
	 * lookups, or `purgeExpired()` to garbage-collect them.
	 */
	async list(filter?: GrantFilter): Promise<Grant[]> {
		const result: Grant[] = [];
		for (const grant of this.grants.values()) {
			if (
				filter?.sessionId !== undefined &&
				grant.sessionId !== filter.sessionId
			) {
				continue;
			}
			if (filter?.action !== undefined && grant.action !== filter.action) {
				continue;
			}
			if (filter?.scope !== undefined && grant.scope !== filter.scope) {
				continue;
			}
			result.push(grant);
		}
		return result;
	}

	/**
	 * Revoke a grant by id. No-op if the grant does not exist
	 * (revocation is idempotent — a second revoke is not an error).
	 */
	async revoke(id: string): Promise<void> {
		this.grants.delete(id);
	}

	/**
	 * Purge expired grants. Iterates the vault, removes any grant
	 * whose `expiresAt` is strictly before `now`, and returns the
	 * number of grants purged. Grants without an `expiresAt` are
	 * considered non-expiring and are kept.
	 */
	async purgeExpired(): Promise<number> {
		const now = new Date();
		let purged = 0;
		for (const [id, grant] of this.grants) {
			if (grant.expiresAt !== undefined && grant.expiresAt < now) {
				this.grants.delete(id);
				purged++;
			}
		}
		return purged;
	}

	/**
	 * Check if a request is covered by a valid (non-expired) grant.
	 * Returns the first matching grant if covered, `undefined`
	 * otherwise.
	 *
	 * Matching is by `action` + `resource`. Both must match exactly;
	 * a grant for `bash:rm` does NOT cover a request for
	 * `file:delete`. A grant with no `resource` matches requests
	 * with no resource; a grant with a `resource` matches only
	 * requests with the same resource string.
	 *
	 * Expired grants (where `expiresAt < now`) are skipped. If no
	 * valid grant covers the request, returns `undefined`.
	 */
	async check(request: GrantRequest): Promise<Grant | undefined> {
		const now = new Date();
		for (const grant of this.grants.values()) {
			if (grant.action !== request.action) {
				continue;
			}
			if (grant.resource !== request.resource) {
				continue;
			}
			if (grant.expiresAt !== undefined && grant.expiresAt < now) {
				continue;
			}
			return grant;
		}
		return undefined;
	}
}
