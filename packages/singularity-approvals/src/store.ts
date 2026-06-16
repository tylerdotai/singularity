/**
 * singularity-approvals — in-memory approval request store.
 *
 * Tracks in-flight approval requests while waiting for user response.
 * Once resolved (approved/denied), requests are converted to Grants
 * and stored in the GrantVault; the pending record can be discarded.
 *
 * This in-memory implementation is suitable for single-instance
 * deployments. For multi-instance deployments, replace with a
 * DB-backed implementation using the same interface.
 */

export type ToolRiskScore = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface ApprovalRequest {
	id: string;
	sessionId: string;
	callId: string;
	tool: string;
	args: unknown;
	riskScore: ToolRiskScore;
	createdAt: number;
	status: "pending" | "approved" | "denied";
}

export class ApprovalStore {
	private readonly requests = new Map<string, ApprovalRequest>();
	/** Callbacks keyed by approval ID, for waking the suspended engine */
	private readonly resolutionCallbacks = new Map<
		string,
		(approved: boolean) => void
	>();

	/**
	 * Create a new pending approval request.
	 * Returns the unique approval ID.
	 */
	createRequest(
		sessionId: string,
		callId: string,
		tool: string,
		args: unknown,
		riskScore: ToolRiskScore,
	): string {
		const id = `approval_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
		const request: ApprovalRequest = {
			id,
			sessionId,
			callId,
			tool,
			args,
			riskScore,
			createdAt: Date.now(),
			status: "pending",
		};
		this.requests.set(id, request);
		return id;
	}

	/**
	 * Get a pending approval request by ID.
	 */
	getRequest(id: string): ApprovalRequest | undefined {
		return this.requests.get(id);
	}

	/**
	 * Resolve a pending approval. Wakes the suspended engine.
	 * Idempotent — resolving an already-resolved request is a no-op.
	 */
	resolve(id: string, approved: boolean): void {
		const request = this.requests.get(id);
		if (!request || request.status !== "pending") return;
		request.status = approved ? "approved" : "denied";

		const callback = this.resolutionCallbacks.get(id);
		if (callback) {
			this.resolutionCallbacks.delete(id);
			callback(approved);
		}
	}

	/**
	 * List all pending approval requests for a session.
	 */
	listPending(sessionId: string): ApprovalRequest[] {
		return [...this.requests.values()].filter(
			(r) => r.sessionId === sessionId && r.status === "pending",
		);
	}

	/**
	 * Register a callback to be called when an approval is resolved.
	 * Returns a Promise that resolves when resolve() is called.
	 */
	waitForResolution(id: string): Promise<boolean> {
		return new Promise<boolean>((resolve) => {
			this.resolutionCallbacks.set(id, resolve);
		});
	}

	/**
	 * Prune old resolved requests to prevent memory growth.
	 * Removes requests older than maxAgeMs that are no longer pending.
	 */
	prune(maxAgeMs = 5 * 60 * 1000): number {
		const cutoff = Date.now() - maxAgeMs;
		let pruned = 0;
		for (const [id, request] of this.requests) {
			if (request.status !== "pending" && request.createdAt < cutoff) {
				this.requests.delete(id);
				pruned++;
			}
		}
		return pruned;
	}
}
