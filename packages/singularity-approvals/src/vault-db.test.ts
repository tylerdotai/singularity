// Phase 4.3 — `SqliteGrantVault` unit tests.
//
// The fourteen `it(...)` blocks below exercise the public surface of the
// DB-backed grant vault that lives in `./vault-db.ts` and maps the
// `Grant` / `GrantRequest` interfaces from `./grant.ts` onto rows in
// the `approvals` table.
//
// The fixture creates a fresh in-memory `bun:sqlite` database in
// `beforeEach` and applies `APPROVALS_TABLE_SQL` directly. The
// migration indexes from `006_approvals.sql.ts` are not required for
// the 1–3 row fixtures here; correctness does not depend on them.
//
// `SqliteGrantVault` is the production implementation of the
// `GrantVault` interface; `InMemoryGrantVault` (in `./vault.ts`)
// remains for unit tests that do not need persistence.
//
// Conventions (mirroring `singularity-core` audit tests):
//   - `bun:test` is imported via its module form (this file is the
//     only one in `src/` that references test imports); the package's
//     `bun-globals.d.ts` exposes the same names as globals so the
//     rest of the package can stay free of test imports.
//   - Non-expiring grants: omit `expiresAt` entirely.
//   - Expired grants: `expiresAt: new Date('2020-01-01T00:00:00Z')`.
//   - Far-future grants: `expiresAt: new Date('9999-12-31T23:59:59Z')`.
//   - `revoke()` writes the epoch timestamp into the `reason` column;
//     after revocation, `get()` returns `undefined` and `check()`
//     skips the row.

import { Database } from "bun:sqlite";
import { beforeEach, describe, expect, it } from "bun:test";
import type { Grant, GrantRequest } from "./grant.ts";
import { SqliteGrantVault } from "./vault-db.ts";

// Migration SQL — the `approvals` table that the vault writes to.
// The 4.2 schema (effect_requested, decision, decided_by, decided_at,
// reason, save_rule, metadata_json) is the storage surface for the
// vault. We inline the DDL here so the test fixture does not depend
// on `singularity-core`; the same SQL is re-exported from the
// 006_approvals migration in singularity-core and from vault-db.ts
// itself.
const APPROVALS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS approvals (
  id                TEXT PRIMARY KEY,
  session_id        TEXT NOT NULL,
  action            TEXT NOT NULL,
  resource          TEXT,
  effect_requested  TEXT,
  decision          TEXT NOT NULL,
  decided_by        TEXT NOT NULL,
  decided_at        TEXT NOT NULL,
  reason            TEXT NOT NULL DEFAULT '',
  save_rule         TEXT,
  metadata_json     TEXT
);
`;

function makeGrant(overrides: Partial<Grant> = {}): Grant {
	return {
		id: "grant_1",
		sessionId: "session_alpha",
		action: "bash:shell",
		resource: "/tmp/test",
		effect: "allow",
		grantedBy: "user_1",
		grantedAt: new Date(),
		expiresAt: new Date("9999-12-31T23:59:59Z"),
		scope: "once",
		metadata: { foo: "bar" },
		...overrides,
	};
}

function makeRequest(overrides: Partial<GrantRequest> = {}): GrantRequest {
	return {
		sessionId: "session_alpha",
		action: "bash:shell",
		resource: "/tmp/test",
		requestedAt: new Date(),
		...overrides,
	};
}

describe("SqliteGrantVault", () => {
	let db: Database;
	let vault: SqliteGrantVault;

	beforeEach(() => {
		db = new Database(":memory:");
		db.exec(APPROVALS_TABLE_SQL);
		vault = new SqliteGrantVault(db);
	});

	it("store() and get() round-trip: all fields survive", async () => {
		const grant = makeGrant({
			id: "grant_round_trip",
			sessionId: "session_alpha",
			action: "bash:shell",
			resource: "/tmp/specific",
			effect: "allow",
			grantedBy: "user_42",
			grantedAt: new Date("2026-06-01T10:00:00Z"),
			expiresAt: new Date("2026-06-30T23:59:59Z"),
			scope: "saved",
			metadata: { matched_rule: "safe_read", confidence: 0.95 },
		});

		await vault.store(grant);

		const fetched = await vault.get("grant_round_trip");
		expect(fetched).toBeDefined();
		expect(fetched?.id).toBe("grant_round_trip");
		expect(fetched?.sessionId).toBe("session_alpha");
		expect(fetched?.action).toBe("bash:shell");
		expect(fetched?.resource).toBe("/tmp/specific");
		expect(fetched?.effect).toBe("allow");
		expect(fetched?.grantedBy).toBe("user_42");
		// Round-tripped as a Date instance; the schema stores ISO-8601 TEXT.
		expect(fetched?.grantedAt).toBeInstanceOf(Date);
		expect(fetched?.grantedAt.toISOString()).toBe("2026-06-01T10:00:00.000Z");
		expect(fetched?.expiresAt).toBeInstanceOf(Date);
		expect(fetched?.expiresAt?.toISOString()).toBe("2026-06-30T23:59:59.000Z");
		expect(fetched?.scope).toBe("saved");
		expect(fetched?.metadata).toEqual({
			matched_rule: "safe_read",
			confidence: 0.95,
		});
	});

	it("store() is idempotent: a second store with the same id replaces", async () => {
		await vault.store(
			makeGrant({ id: "grant_idem", grantedBy: "user_1", scope: "once" }),
		);
		await vault.store(
			makeGrant({ id: "grant_idem", grantedBy: "user_2", scope: "saved" }),
		);

		// Only one row exists for this id (the upsert replaced, not appended).
		const all = await vault.list();
		const matches = all.filter((g) => g.id === "grant_idem");
		expect(matches).toHaveLength(1);

		// The second store's values win.
		const fetched = await vault.get("grant_idem");
		expect(fetched?.grantedBy).toBe("user_2");
		expect(fetched?.scope).toBe("saved");
	});

	it("list() with no filter returns every stored grant", async () => {
		await vault.store(makeGrant({ id: "g1", sessionId: "sess_a" }));
		await vault.store(makeGrant({ id: "g2", sessionId: "sess_b" }));
		await vault.store(makeGrant({ id: "g3", sessionId: "sess_a" }));

		const all = await vault.list();
		expect(all).toHaveLength(3);
		const ids = all.map((g) => g.id).sort();
		expect(ids).toEqual(["g1", "g2", "g3"]);
	});

	it("list() filters by sessionId", async () => {
		await vault.store(makeGrant({ id: "a1", sessionId: "sess_alpha" }));
		await vault.store(makeGrant({ id: "a2", sessionId: "sess_alpha" }));
		await vault.store(makeGrant({ id: "b1", sessionId: "sess_beta" }));

		const alpha = await vault.list({ sessionId: "sess_alpha" });
		expect(alpha).toHaveLength(2);
		expect(alpha.every((g) => g.sessionId === "sess_alpha")).toBe(true);
		const ids = alpha.map((g) => g.id).sort();
		expect(ids).toEqual(["a1", "a2"]);

		// Unknown session yields an empty result, not an error.
		const none = await vault.list({ sessionId: "sess_gamma" });
		expect(none).toHaveLength(0);
	});

	it("list() filters by action", async () => {
		await vault.store(makeGrant({ id: "r1", action: "read:file" }));
		await vault.store(makeGrant({ id: "r2", action: "read:file" }));
		await vault.store(makeGrant({ id: "w1", action: "write:file" }));
		await vault.store(makeGrant({ id: "d1", action: "delete:file" }));

		const reads = await vault.list({ action: "read:file" });
		expect(reads).toHaveLength(2);
		expect(reads.every((g) => g.action === "read:file")).toBe(true);

		const deletes = await vault.list({ action: "delete:file" });
		expect(deletes).toHaveLength(1);
		expect(deletes[0]?.id).toBe("d1");
	});

	it("list() filters by scope (mapped to save_rule)", async () => {
		await vault.store(makeGrant({ id: "o1", scope: "once" }));
		await vault.store(makeGrant({ id: "o2", scope: "once" }));
		await vault.store(makeGrant({ id: "s1", scope: "saved" }));

		const oneShot = await vault.list({ scope: "once" });
		expect(oneShot).toHaveLength(2);
		expect(oneShot.every((g) => g.scope === "once")).toBe(true);

		const saved = await vault.list({ scope: "saved" });
		expect(saved).toHaveLength(1);
		expect(saved[0]?.id).toBe("s1");
	});

	it("revoke() makes get() return undefined", async () => {
		await vault.store(makeGrant({ id: "grant_to_revoke" }));

		// Sanity check: the grant is visible before revoke.
		const before = await vault.get("grant_to_revoke");
		expect(before).toBeDefined();

		await vault.revoke("grant_to_revoke");

		// After revoke, the vault no longer surfaces the row.
		const after = await vault.get("grant_to_revoke");
		expect(after).toBeUndefined();
	});

	it("check() matches by action + resource", async () => {
		await vault.store(
			makeGrant({
				id: "g_exact",
				action: "bash:shell",
				resource: "/tmp/exact",
			}),
		);
		// A different action + resource pair — must not match.
		await vault.store(
			makeGrant({
				id: "g_other",
				action: "read:file",
				resource: "/var/log/app.log",
			}),
		);

		const match = await vault.check(
			makeRequest({ action: "bash:shell", resource: "/tmp/exact" }),
		);
		expect(match).toBeDefined();
		expect(match?.id).toBe("g_exact");

		const noMatch = await vault.check(
			makeRequest({ action: "bash:shell", resource: "/tmp/different" }),
		);
		expect(noMatch).toBeUndefined();
	});

	it("check() with undefined resource matches grants with no resource", async () => {
		// Grant with no resource.
		await vault.store(
			makeGrant({
				id: "g_no_resource",
				action: "session:continue",
				resource: undefined,
			}),
		);
		// Grant with a concrete resource — must not match a no-resource request.
		await vault.store(
			makeGrant({
				id: "g_with_resource",
				action: "session:continue",
				resource: "/some/path",
			}),
		);

		const match = await vault.check(
			makeRequest({ action: "session:continue", resource: undefined }),
		);
		expect(match).toBeDefined();
		expect(match?.id).toBe("g_no_resource");
	});

	it("check() skips expired grants (expires_at filter)", async () => {
		// Expired grant — must not be returned.
		await vault.store(
			makeGrant({
				id: "g_expired",
				action: "bash:shell",
				resource: "/tmp/x",
				expiresAt: new Date("2020-01-01T00:00:00Z"),
			}),
		);
		// Far-future grant — must be returned.
		await vault.store(
			makeGrant({
				id: "g_fresh",
				action: "bash:shell",
				resource: "/tmp/x",
				expiresAt: new Date("9999-12-31T23:59:59Z"),
			}),
		);

		const match = await vault.check(
			makeRequest({ action: "bash:shell", resource: "/tmp/x" }),
		);
		expect(match).toBeDefined();
		expect(match?.id).toBe("g_fresh");
	});

	it("check() returns the most recent grant on multiple matches (decided_at DESC)", async () => {
		// Two grants for the same action + resource, different timestamps.
		await vault.store(
			makeGrant({
				id: "g_old",
				action: "bash:shell",
				resource: "/tmp/multi",
				grantedAt: new Date("2026-06-01T10:00:00Z"),
			}),
		);
		await vault.store(
			makeGrant({
				id: "g_new",
				action: "bash:shell",
				resource: "/tmp/multi",
				grantedAt: new Date("2026-06-02T10:00:00Z"),
			}),
		);

		const match = await vault.check(
			makeRequest({ action: "bash:shell", resource: "/tmp/multi" }),
		);
		expect(match).toBeDefined();
		expect(match?.id).toBe("g_new");
	});

	it("purgeExpired() removes expired grants and returns the count", async () => {
		await vault.store(
			makeGrant({
				id: "g_old_purge",
				expiresAt: new Date("2020-01-01T00:00:00Z"),
			}),
		);
		await vault.store(
			makeGrant({
				id: "g_fresh_purge",
				expiresAt: new Date("9999-12-31T23:59:59Z"),
			}),
		);
		// Non-expiring grant (no expiresAt) — must survive purgeExpired.
		await vault.store(
			makeGrant({
				id: "g_never_expires",
				expiresAt: undefined,
			}),
		);

		const purged = await vault.purgeExpired();
		expect(purged).toBe(1);

		// Only the non-expired grants remain in the vault.
		const remaining = await vault.list();
		const ids = remaining.map((g) => g.id).sort();
		expect(ids).toEqual(["g_fresh_purge", "g_never_expires"]);

		// The expired row is gone — `get()` returns undefined.
		const gone = await vault.get("g_old_purge");
		expect(gone).toBeUndefined();
	});

	it('store() persists effect="deny" as decision="deny" in the DB', async () => {
		await vault.store(
			makeGrant({
				id: "g_deny",
				effect: "deny",
			}),
		);

		// The vault surfaces the deny grant via get().
		const fetched = await vault.get("g_deny");
		expect(fetched).toBeDefined();
		expect(fetched?.effect).toBe("deny");

		// The underlying row carries decision='deny' (not 'allow').
		const row = db
			.query<{ decision: string }, [string]>(
				"SELECT decision FROM approvals WHERE id = ?",
			)
			.get("g_deny");
		expect(row?.decision).toBe("deny");
	});

	it("list() AND-combines sessionId + action filters", async () => {
		// Same session, different actions.
		await vault.store(
			makeGrant({ id: "a_read", sessionId: "sess_x", action: "read:file" }),
		);
		await vault.store(
			makeGrant({ id: "a_write", sessionId: "sess_x", action: "write:file" }),
		);
		// Same action, different session.
		await vault.store(
			makeGrant({ id: "b_read", sessionId: "sess_y", action: "read:file" }),
		);
		// Neither filter matches.
		await vault.store(
			makeGrant({ id: "b_write", sessionId: "sess_y", action: "write:file" }),
		);

		// sessionId=+action: only one row matches both.
		const bothX = await vault.list({
			sessionId: "sess_x",
			action: "read:file",
		});
		expect(bothX).toHaveLength(1);
		expect(bothX[0]?.id).toBe("a_read");

		// AND-combination: session x + action write:file has 1 row.
		const xWrite = await vault.list({
			sessionId: "sess_x",
			action: "write:file",
		});
		expect(xWrite).toHaveLength(1);
		expect(xWrite[0]?.id).toBe("a_write");

		// sessionId=unknown: empty result regardless of action.
		const none = await vault.list({
			sessionId: "sess_missing",
			action: "read:file",
		});
		expect(none).toHaveLength(0);
	});
});
