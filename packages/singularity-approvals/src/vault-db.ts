// Phase 4.3 — DB-backed `GrantVault` implementation.
//
// Reuses the `approvals` table from Phase 4.2 (see
// `packages/singularity-core/src/approvals/schema.sql.ts`) for grant
// storage. The schema is shared with the audit log; the vault only
// ever reads/writes rows whose `decision` is `'allow'` or `'deny'`,
// which are the two outcomes the policy engine persists as a
// reusable grant. Rows with `decision = 'ask'` are intermediate
// request/decision records owned by the audit log and are invisible
// to the vault.
//
// Mapping (Grant field -> approvals column):
//   * `id`             -> `id`               (PK)
//   * `sessionId`      -> `session_id`
//   * `action`         -> `action`
//   * `resource`       -> `resource`         (nullable)
//   * `effect`         -> `decision`         ('allow' | 'deny')
//   * `effect`         -> `effect_requested` (mirrors the decided effect;
//                        the schema has no separate "requested effect"
//                        on a stored Grant)
//   * `grantedBy`      -> `decided_by`
//   * `grantedAt`      -> `decided_at`       (ISO-8601 TEXT)
//   * `expiresAt`      -> `reason`           (ISO-8601, FAR_FUTURE, or EPOCH)
//   * `scope`          -> `save_rule`        ('once' | 'saved' | custom)
//   * `metadata`       -> `metadata_json`    (JSON.stringify; opaque blob)
//
// The `reason` column is overloaded for three states:
//   * `'9999-12-31T23:59:59.999Z'` (FAR_FUTURE) — non-expiring grant
//   * `'1970-01-01T00:00:00.000Z'` (EPOCH)       — soft-revoked
//   * any other ISO-8601 timestamp  — the grant's `expiresAt`
//
// Soft revoke (setting `reason = EPOCH`) is preferred over DELETE
// because the audit log layer reads the same table and benefits from
// retaining the row's history. Every public read path (`get`, `list`,
// `check`) filters out revoked rows via `reason != EPOCH`, so the
// vault's observable behaviour matches `InMemoryGrantVault.revoke`,
// which deletes the row outright.

import type { Database } from "bun:sqlite";
import type { Grant, GrantRequest } from "./grant.ts";
import type { GrantFilter, GrantVault } from "./vault.ts";

// Sentinel ISO-8601 timestamps used inside the `reason` column.
// FAR_FUTURE marks a non-expiring grant; EPOCH marks a soft-revoked
// grant. Both are valid ISO-8601 strings that compare correctly
// against any real timestamp with `>`, `<`, or `!=`.
const FAR_FUTURE = "9999-12-31T23:59:59.999Z";
const EPOCH = "1970-01-01T00:00:00.000Z";

// The two decision values the vault ever persists. `'ask'` is owned
// by the audit log and is excluded from every vault read/write.
const GRANT_DECISIONS = "'allow', 'deny'";

// The shape returned by `SELECT * FROM approvals`. Every field on
// the table is named here, including the `decision` UNION that
// the schema enforces (`'allow' | 'ask' | 'deny'`).
interface ApprovalRow {
	id: string;
	session_id: string;
	action: string;
	resource: string | null;
	effect_requested: string;
	decision: "allow" | "ask" | "deny";
	decided_by: string;
	decided_at: string;
	reason: string;
	save_rule: string;
	metadata_json: string | null;
}

/**
 * Narrow a row's `decision` string to the `'allow' | 'deny'` subset
 * the `Grant` interface allows. Vault queries already restrict the
 * `decision` column via `IN (...)`, so this guard only fires for
 * adversarial or corrupted rows; it keeps the rest of `rowToGrant`
 * strict without an `as any` cast.
 */
function isGrantDecision(value: string): value is "allow" | "deny" {
	return value === "allow" || value === "deny";
}

/**
 * Convert one row of the `approvals` table into a `Grant`.
 *
 * Translation rules (see file header for the full mapping table):
 *   * `decided_at`  -> `grantedAt` (Date)
 *   * `reason`      -> `expiresAt` (Date | undefined)
 *                        FAR_FUTURE -> undefined (non-expiring)
 *                        EPOCH       -> undefined (revoked; row should
 *                                      never reach this function via a
 *                                      public read path, but the
 *                                      defensive mapping is symmetric)
 *                        otherwise   -> new Date(reason)
 *   * `save_rule`   -> `scope` (only emitted when the value carries
 *                     information beyond the schema default 'once')
 *   * `metadata_json` -> `metadata` (parsed; undefined for null/empty)
 *   * `decision`    -> `effect` ('allow' | 'deny', narrowed by
 *                     `isGrantDecision`)
 */
function rowToGrant(row: ApprovalRow): Grant {
	const grantedAt = new Date(row.decided_at);
	const expiresAt =
		row.reason === FAR_FUTURE || row.reason === EPOCH
			? undefined
			: new Date(row.reason);

	const metadata =
		row.metadata_json !== null && row.metadata_json !== ""
			? (JSON.parse(row.metadata_json) as Record<string, unknown>)
			: undefined;

	const scope: string | undefined =
		row.save_rule !== null ? row.save_rule : undefined;

	const effect: "allow" | "deny" = isGrantDecision(row.decision)
		? row.decision
		: "allow";

	const grant: Grant = {
		id: row.id,
		sessionId: row.session_id,
		action: row.action,
		effect,
		grantedBy: row.decided_by,
		grantedAt,
		scope,
		...(row.resource !== null ? { resource: row.resource } : {}),
		...(expiresAt !== undefined ? { expiresAt } : {}),
		...(metadata !== undefined ? { metadata } : {}),
	};
	return grant;
}

/**
 * SQLite-backed implementation of `GrantVault` that reads and
 * writes grant records from the `approvals` table.
 *
 * The constructor takes a `bun:sqlite` `Database` connection that
 * must already have the Phase 4.2 `approvals` schema applied
 * (typically via `db.exec(APPROVALS_TABLE_SQL)`). The vault does
 * NOT run migrations itself — migration ownership stays with the
 * layer that owns the database lifecycle (see
 * `docs/singularity/APPROVALS.md` for the split).
 *
 * Read paths (`get`, `list`, `check`) filter out revoked grants
 * (rows whose `reason = EPOCH`) so the vault matches the
 * `InMemoryGrantVault` observable behaviour, where `revoke()`
 * deletes the grant outright.
 */
export class SqliteGrantVault implements GrantVault {
	constructor(private readonly db: Database) {}

	/**
	 * Store a grant. Uses `INSERT OR REPLACE` so re-storing a grant
	 * with the same `id` upserts in place; this matches the
	 * idempotent-store contract the Phase 4.3 notepad calls out.
	 *
	 * The `reason` column receives the grant's `expiresAt` ISO
	 * string, or `FAR_FUTURE` for non-expiring grants. The
	 * `effect_requested` column mirrors `effect` because the
	 * `Grant` interface does not carry a separate "requested
	 * effect" field — by the time a row is in the `approvals`
	 * table, the policy engine has already rendered a decision.
	 */
	async store(grant: Grant): Promise<void> {
		const reason = grant.expiresAt?.toISOString() ?? FAR_FUTURE;
		const metadataJson =
			grant.metadata !== undefined ? JSON.stringify(grant.metadata) : null;
		const resource = grant.resource ?? null;

		this.db
			.prepare(
				`INSERT OR REPLACE INTO approvals (
					id,
					session_id,
					action,
					resource,
					effect_requested,
					decision,
					decided_by,
					decided_at,
					reason,
					save_rule,
					metadata_json
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				grant.id,
				grant.sessionId,
				grant.action,
				resource,
				grant.effect,
				grant.effect,
				grant.grantedBy,
				grant.grantedAt.toISOString(),
				reason,
				grant.scope ?? "once",
				metadataJson,
			);
	}

	/**
	 * Get a grant by id. Returns `undefined` if no grant with that
	 * id is stored, or if the matching row has been soft-revoked
	 * (`reason = EPOCH`). Only rows whose `decision` is `'allow'`
	 * or `'deny'` are returned — `'ask'` rows belong to the audit
	 * log and are invisible to the vault.
	 */
	async get(id: string): Promise<Grant | undefined> {
		const row = this.db
			.prepare(
				`SELECT * FROM approvals
				 WHERE id = ?
				   AND decision IN (${GRANT_DECISIONS})
				   AND reason != ?`,
			)
			.get(id, EPOCH) as ApprovalRow | null;
		return row !== null && row !== undefined ? rowToGrant(row) : undefined;
	}

	/**
	 * List grants with optional filter. All filter fields are
	 * AND-combined. An empty filter returns ALL non-revoked grants
	 * (any effect, any session). Revoked grants (`reason = EPOCH`)
	 * are excluded so `list()` after `revoke()` matches the
	 * `InMemoryGrantVault` behaviour, where revoked grants simply
	 * disappear from the listing.
	 *
	 * Filter mapping:
	 *   * `sessionId` -> `session_id = ?`
	 *   * `action`    -> `action = ?`
	 *   * `scope`     -> `save_rule = ?`
	 */
	async list(filter?: GrantFilter): Promise<Grant[]> {
		const conditions: string[] = [
			`decision IN (${GRANT_DECISIONS})`,
			"reason != ?",
		];
		const params: unknown[] = [EPOCH];

		if (filter?.sessionId !== undefined) {
			conditions.push("session_id = ?");
			params.push(filter.sessionId);
		}
		if (filter?.action !== undefined) {
			conditions.push("action = ?");
			params.push(filter.action);
		}
		if (filter?.scope !== undefined) {
			conditions.push("save_rule = ?");
			params.push(filter.scope);
		}

		const where = `WHERE ${conditions.join(" AND ")}`;
		const rows = this.db
			.prepare(`SELECT * FROM approvals ${where}`)
			.all(...(params as (string | number | null)[])) as ApprovalRow[];
		return rows.map(rowToGrant);
	}

	/**
	 * Revoke a grant by id. Soft-revokes by setting
	 * `reason = EPOCH` so the audit log retains the row. The
	 * vault itself treats the grant as gone (read paths filter
	 * on `reason != EPOCH`).
	 *
	 * No-op if the grant does not exist or is already revoked —
	 * revocation is idempotent, matching `InMemoryGrantVault`.
	 */
	async revoke(id: string): Promise<void> {
		this.db
			.prepare(
				`UPDATE approvals
				 SET reason = ?
				 WHERE id = ?
				   AND decision IN (${GRANT_DECISIONS})`,
			)
			.run(EPOCH, id);
	}

	/**
	 * Purge expired grants. Soft-purges by setting
	 * `reason = EPOCH` (so revoked and purged rows are
	 * indistinguishable to the read paths). Returns the number
	 * of rows whose `reason` actually changed — already-revoked
	 * rows contribute 0 to the count, even though they match the
	 * WHERE clause.
	 *
	 * Non-expiring grants (`reason = FAR_FUTURE`) are explicitly
	 * excluded. Only `'allow'` and `'deny'` rows are considered;
	 * audit-log `'ask'` rows are skipped.
	 */
	async purgeExpired(): Promise<number> {
		const now = new Date().toISOString();
		const result = this.db
			.prepare(
				`UPDATE approvals
				 SET reason = ?
				 WHERE decision IN (${GRANT_DECISIONS})
				   AND reason != ?
				   AND reason != ?
				   AND reason < ?`,
			)
			.run(EPOCH, EPOCH, FAR_FUTURE, now);
		return result.changes;
	}

	/**
	 * Check if a request is covered by a valid (non-revoked,
	 * non-expired) `'allow'` grant. Returns the most recent
	 * matching grant, or `undefined` if no grant covers the
	 * request.
	 *
	 * Matching is by `action` + `resource`. The resource match
	 * uses SQLite's three-valued logic: a stored `NULL` matches
	 * a request whose `resource` is `undefined`, and a stored
	 * non-null value matches an identical request value. This
	 * keeps the contract identical to `InMemoryGrantVault.check`,
	 * where `grant.resource === request.resource` does the same
	 * job in JS-land.
	 *
	 * The `reason` column carries `expiresAt`, so the
	 * non-expired filter is `reason = FAR_FUTURE OR reason > now`.
	 * Revoked grants are filtered out by `reason != EPOCH`.
	 *
	 * The result is ordered by `decided_at DESC LIMIT 1` — if
	 * multiple grants cover the same action/resource, the most
	 * recently granted one wins.
	 */
	async check(request: GrantRequest): Promise<Grant | undefined> {
		const now = new Date().toISOString();
		const resource = request.resource ?? null;
		const row = this.db
			.prepare(
				`SELECT * FROM approvals
				 WHERE action = ?
				   AND (resource = ? OR (resource IS NULL AND ? IS NULL))
				   AND decision = 'allow'
				   AND reason != ?
				   AND (reason = ? OR reason > ?)
				 ORDER BY decided_at DESC
				 LIMIT 1`,
			)
			.get(
				request.action,
				resource,
				resource,
				EPOCH,
				FAR_FUTURE,
				now,
			) as ApprovalRow | null;
		return row !== null && row !== undefined ? rowToGrant(row) : undefined;
	}
}
