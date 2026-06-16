// Phase 4.0 — approval policy interface stub.
//
// The policy is the top-level entry point that combines the vault,
// the notifier, and the guard. This module is interface-only in
// Phase 4.0; the concrete implementation lands in Phase 4.1.

import type { Grant, GrantRequest } from "./grant.ts";
import type { ApprovalNotifier } from "./notify.js";
import type { GrantVault } from "./vault.js";

// The approval policy — combines vault + notifier + guard.
//
// `request(request)` returns a `Grant` if the request is approved
// (either from a pre-existing vault entry or from a fresh approval
// round). If the request is denied, `request` throws.
//
// Phase 4.1 will provide the concrete implementation that:
//   1. Checks the vault for a matching non-expired grant
//   2. If absent, fans out a `GrantRequest` via the notifier
//   3. Awaits a human decision (CLI prompt, Telegram reply, etc.)
//   4. On approval, stores the new `Grant` in the vault
//   5. Returns the stored `Grant`
export interface ApprovalPolicy {
	request(request: GrantRequest): Promise<Grant>;
}

export interface ApprovalPolicyOptions {
	vault: GrantVault;
	notifier?: ApprovalNotifier;
	approver?: (request: GrantRequest) => Promise<Grant>;
}

export class DefaultApprovalPolicy implements ApprovalPolicy {
	private readonly vault: GrantVault;
	private readonly notifier?: ApprovalNotifier;
	private readonly approver?: (request: GrantRequest) => Promise<Grant>;

	constructor(options: ApprovalPolicyOptions) {
		this.vault = options.vault;
		this.notifier = options.notifier;
		this.approver = options.approver;
	}

	async request(request: GrantRequest): Promise<Grant> {
		const existing = await this.vault.check(request);
		if (existing) {
			return existing;
		}

		if (this.notifier) {
			await this.notifier.notify(request);
		}

		if (this.approver) {
			const grant = await this.approver(request);
			await this.vault.store(grant);
			return grant;
		}

		throw new Error(
			`No prior grant for '${request.action}' and no approver configured. ` +
				`Either pre-approve the tool or provide an approver callback.`,
		);
	}
}
