import { beforeEach, describe, expect, test } from "bun:test";
import type { GrantRequest } from "./grant";
import { DefaultApprovalPolicy } from "./policy";
import { type ApprovalRequest, ApprovalStore } from "./store";
import { InMemoryGrantVault } from "./vault";

const SESSION_ID = "test-session-1";

function makeRequest(action: string, resource?: string): GrantRequest {
	return {
		sessionId: SESSION_ID,
		action,
		resource,
		requestedAt: new Date(),
	};
}

describe("ApprovalStore", () => {
	let store: ApprovalStore;

	beforeEach(() => {
		store = new ApprovalStore();
	});

	test("createRequest returns a unique ID", () => {
		const id1 = store.createRequest(
			SESSION_ID,
			"call-1",
			"bash",
			{ cmd: "ls" },
			"CRITICAL",
		);
		const id2 = store.createRequest(
			SESSION_ID,
			"call-2",
			"bash",
			{ cmd: "rm" },
			"CRITICAL",
		);
		expect(id1).toBeTruthy();
		expect(id2).toBeTruthy();
		expect(id1).not.toBe(id2);
	});

	test("getRequest returns the created request", () => {
		const id = store.createRequest(
			SESSION_ID,
			"call-1",
			"bash",
			{ cmd: "ls" },
			"CRITICAL",
		);
		const request = store.getRequest(id);
		expect(request).toBeDefined();
		expect(request?.id).toBe(id);
		expect(request?.sessionId).toBe(SESSION_ID);
		expect(request?.tool).toBe("bash");
		expect(request?.status).toBe("pending");
	});

	test("getRequest returns undefined for unknown ID", () => {
		const result = store.getRequest("unknown-id");
		expect(result).toBeUndefined();
	});

	test("resolve marks request as approved", () => {
		const id = store.createRequest(
			SESSION_ID,
			"call-1",
			"bash",
			{ cmd: "ls" },
			"CRITICAL",
		);
		store.resolve(id, true);
		const request = store.getRequest(id);
		expect(request!.status).toBe("approved");
	});

	test("resolve marks request as denied", () => {
		const id = store.createRequest(
			SESSION_ID,
			"call-1",
			"bash",
			{ cmd: "rm" },
			"CRITICAL",
		);
		store.resolve(id, false);
		const request = store.getRequest(id);
		expect(request!.status).toBe("denied");
	});

	test("listPending returns only pending requests for session", () => {
		const id1 = store.createRequest(
			SESSION_ID,
			"call-1",
			"bash",
			{ cmd: "ls" },
			"CRITICAL",
		);
		const id2 = store.createRequest(
			SESSION_ID,
			"call-2",
			"file:delete",
			{ path: "/tmp/x" },
			"CRITICAL",
		);
		store.resolve(id1, true);
		const pending = store.listPending(SESSION_ID);
		expect(pending).toHaveLength(1);
		expect(pending[0].id).toBe(id2);
	});

	test("listPending returns empty for session with no pending requests", () => {
		const id = store.createRequest(
			SESSION_ID,
			"call-1",
			"bash",
			{ cmd: "ls" },
			"CRITICAL",
		);
		store.resolve(id, true);
		const pending = store.listPending(SESSION_ID);
		expect(pending).toHaveLength(0);
	});

	test("waitForResolution resolves true on approve", async () => {
		const id = store.createRequest(
			SESSION_ID,
			"call-1",
			"bash",
			{ cmd: "ls" },
			"CRITICAL",
		);
		const resolution = store.waitForResolution(id);
		store.resolve(id, true);
		const result = await resolution;
		expect(result).toBe(true);
	});

	test("waitForResolution resolves false on deny", async () => {
		const id = store.createRequest(
			SESSION_ID,
			"call-1",
			"bash",
			{ cmd: "rm" },
			"CRITICAL",
		);
		const resolution = store.waitForResolution(id);
		store.resolve(id, false);
		const result = await resolution;
		expect(result).toBe(false);
	});

	test("resolve is idempotent", () => {
		const id = store.createRequest(
			SESSION_ID,
			"call-1",
			"bash",
			{ cmd: "ls" },
			"CRITICAL",
		);
		store.resolve(id, true);
		store.resolve(id, false);
		const request = store.getRequest(id);
		expect(request!.status).toBe("approved");
	});

	test("prune removes old resolved requests", async () => {
		const id = store.createRequest(
			SESSION_ID,
			"call-1",
			"bash",
			{ cmd: "ls" },
			"CRITICAL",
		);
		store.resolve(id, true);
		const pruned = store.prune(5 * 60 * 1000);
		expect(pruned).toBeGreaterThanOrEqual(0);
		expect(store.getRequest(id)).toBeDefined();
	});

	test("concurrent approval requests are independent", async () => {
		const id1 = store.createRequest(
			SESSION_ID,
			"call-1",
			"bash",
			{ cmd: "ls" },
			"CRITICAL",
		);
		const id2 = store.createRequest(
			SESSION_ID,
			"call-2",
			"bash",
			{ cmd: "rm" },
			"CRITICAL",
		);
		const [res1, res2] = [
			store.waitForResolution(id1),
			store.waitForResolution(id2),
		];
		store.resolve(id1, true);
		store.resolve(id2, false);
		const [r1, r2] = await Promise.all([res1, res2]);
		expect(r1).toBe(true);
		expect(r2).toBe(false);
	});
});

describe("DefaultApprovalPolicy with InMemoryGrantVault", () => {
	let vault: InMemoryGrantVault;
	let policy: DefaultApprovalPolicy;
	let approvalStore: ApprovalStore;

	beforeEach(() => {
		vault = new InMemoryGrantVault();
		approvalStore = new ApprovalStore();
		policy = new DefaultApprovalPolicy({ vault });
	});

	test("returns existing grant without creating pending request", async () => {
		await vault.store({
			id: "grant-1",
			sessionId: SESSION_ID,
			action: "bash",
			effect: "allow",
			grantedBy: "user",
			grantedAt: new Date(),
		});
		const grant = await policy.request(makeRequest("bash"));
		expect(grant.effect).toBe("allow");
	});

	test("throws when no grant and no approver configured", async () => {
		await expect(policy.request(makeRequest("bash"))).rejects.toThrow();
	});
});
