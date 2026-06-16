import type { GrantRequest } from "./grant.ts";
import type { GrantVault } from "./vault.ts";

export interface ApprovalGuard {
	guard<T>(request: GrantRequest, operation: () => Promise<T>): Promise<T>;
}

/**
 * Check if a tool call requires approval based on its metadata.
 * Returns true if the tool has approvalRequired=true.
 */
export function toolRequiresApproval(
	toolName: string,
	approvalRequired: boolean,
): boolean {
	return approvalRequired;
}

/**
 * Result of an approval check.
 */
export type ApprovalResult =
	| { approved: true }
	| { approved: false; reason: "no_grant" | "denied" | "expired" };

/**
 * Sqlite-backed ApprovalGuard implementation.
 *
 * Wraps a GrantVault and provides:
 * - requiresApproval(toolName, approvalRequired): whether a tool needs approval
 * - checkApproval(sessionId, toolName, input?): whether a session has approval
 *
 * The guard does NOT store grants itself — that responsibility stays with
 * the GrantVault. The guard only coordinates the check.
 */
export class SqliteApprovalGuard implements ApprovalGuard {
	constructor(private vault: GrantVault) {}

	/**
	 * Check if a tool call requires approval.
	 * A tool requires approval if its metadata has approvalRequired=true.
	 */
	requiresApproval(toolName: string, approvalRequired: boolean): boolean {
		return toolRequiresApproval(toolName, approvalRequired);
	}

	/**
	 * Check if a session has a valid (non-expired, non-revoked) grant
	 * for the given tool call.
	 *
	 * Returns ApprovalResult.approved=true if a valid 'allow' grant exists.
	 * Returns ApprovalResult.approved=false if no grant, denied grant,
	 * or expired grant.
	 */
	async checkApproval(
		sessionId: string,
		toolName: string,
		input?: unknown,
	): Promise<ApprovalResult> {
		const request: GrantRequest = {
			sessionId,
			action: toolName,
			resource:
				input !== undefined ? JSON.stringify(input).slice(0, 200) : undefined,
			requestedAt: new Date(),
		};
		const grant = await this.vault.check(request);
		if (!grant) {
			return { approved: false, reason: "no_grant" };
		}
		if (grant.effect === "deny") {
			return { approved: false, reason: "denied" };
		}
		// Check expiration
		if (grant.expiresAt !== undefined && grant.expiresAt < new Date()) {
			return { approved: false, reason: "expired" };
		}
		return { approved: true };
	}

	/**
	 * Guard an operation by checking approval first.
	 * If no valid 'allow' grant exists, throws an error.
	 */
	async guard<T>(
		request: GrantRequest,
		operation: () => Promise<T>,
	): Promise<T> {
		const grant = await this.vault.check(request);
		if (!grant || grant.effect === "deny") {
			throw new Error(`Tool '${request.action}' denied by approval policy`);
		}
		// Check expiration
		if (grant.expiresAt !== undefined && grant.expiresAt < new Date()) {
			throw new Error(`Tool '${request.action}' grant has expired`);
		}
		return operation();
	}
}
