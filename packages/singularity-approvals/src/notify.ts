// Phase 4.0 — approval notification interface + multi-channel stub.
//
// The notification subsystem fans out `GrantRequest`s to one or
// more channels (CLI prompt, Telegram, Discord, email). Each
// channel implements `ApprovalNotifier`. The `MultiChannelNotifier`
// composes a list of channels and awaits all of them in parallel.
//
// Future phases will register concrete adapters:
//   - Phase 7: CLI prompt (TTY-based, in-process)
//   - Phase 8: Telegram, Discord, email adapters (network I/O)

import type { GrantRequest } from "./grant.ts";

// A single notification channel (e.g., CLI prompt, Telegram, Discord).
//
// `name` is the channel identifier used for logging, routing, and
// audit trails. It is `readonly` so a notifier cannot claim a
// different channel identity at runtime.
//
// `notify(request)` returns when the channel has *accepted* the
// request — not when the request has been approved. The
// accept/approve distinction matters for channels that batch
// (e.g., a digest channel that aggregates several requests before
// sending a single message). Approval itself is a separate flow
// handled by the policy layer (Phase 4.1).
export interface ApprovalNotifier {
	readonly name: string;
	notify(request: GrantRequest): Promise<void>;
}

// Multi-channel fan-out — sends to all configured channels in parallel.
//
// `MultiChannelNotifier` is itself an `ApprovalNotifier` (its
// `name` is `"multi"`), so it can be nested inside another
// `MultiChannelNotifier` if a future phase needs two-level
// routing (e.g., primary channels + audit channels).
export class MultiChannelNotifier implements ApprovalNotifier {
	readonly name = "multi";
	private readonly notifiers: readonly ApprovalNotifier[];

	constructor(notifiers: readonly ApprovalNotifier[]) {
		this.notifiers = notifiers;
	}

	/**
	 * Fan out `request` to every configured channel in parallel.
	 * Resolves only when all channels have accepted the request. If
	 * any channel rejects, the returned promise rejects with the
	 * first rejection (the others may still be in flight; callers
	 * that need bounded concurrency will need a future variant).
	 */
	async notify(request: GrantRequest): Promise<void> {
		await Promise.all(this.notifiers.map((n) => n.notify(request)));
	}
}
