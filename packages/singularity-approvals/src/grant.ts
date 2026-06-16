// Phase 4.0 — approval grant core types.
//
// Pure type declarations: no runtime code. The `GrantVault` and
// `ApprovalNotifier` modules (in `./vault.ts` and `./notify.ts`)
// consume these types, and `Grant` is the canonical row shape for the
// future `approvals` table from `docs/singularity/ARCHITECTURE.md`
// lines 152-163.
//
// All fields are `readonly` so a `Grant` value is immutable once
// stored in the vault. Mutation flows through the vault's
// `store()` / `revoke()` methods, not through field assignment.

// The effect a grant conveys.
//   - "allow" → the action is permitted
//   - "deny"  → the action is blocked (a permanent override for the
//               session+action+resource triple)
export type GrantEffect = "allow" | "deny";

// A granted permission — time-limited, scoped, audit-able.
//
// Mirrors the future `approvals` table from
// `docs/singularity/ARCHITECTURE.md` lines 152-163, minus the
// DB-specific fields. Phase 4.2 will map this interface onto the
// `approvals` row shape.
export interface Grant {
	readonly id: string; // UUID; the primary key
	readonly sessionId: string; // owning session (FK to sessions)
	readonly action: string; // e.g. "bash:rm", "file:delete", "network:fetch"
	readonly resource?: string; // e.g. "/path/to/file", "https://..."
	readonly effect: GrantEffect;
	readonly grantedBy: string; // user ID, "system", or channel name
	readonly grantedAt: Date;
	readonly expiresAt?: Date; // time-limited (per PVM concept)
	readonly scope?: string; // project, profile, or custom scope label
	readonly metadata?: Readonly<Record<string, unknown>>;
}

// A request for approval — what the agent wants to do.
//
// Distinct from `Grant`: a `GrantRequest` is the *request* (input
// to the policy); a `Grant` is the *outcome* (stored in the vault).
// The `requestedAt` timestamp records when the request was made;
// the approval workflow pairs this with the future `decided_at`
// column from the `approvals` table.
export interface GrantRequest {
	readonly sessionId: string;
	readonly action: string;
	readonly resource?: string;
	readonly reason?: string; // why the agent wants to do this
	readonly requestedAt: Date;
}
