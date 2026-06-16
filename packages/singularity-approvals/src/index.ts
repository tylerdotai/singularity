// Phase 4.0 — `singularity-approvals` barrel.
//
// Public surface of the `singularity-approvals` package:
//   - grant:    `GrantEffect` type, `Grant` + `GrantRequest` interfaces
//   - vault:    `GrantVault` interface, `InMemoryGrantVault` stub class,
//               `GrantFilter` interface
//   - notify:   `ApprovalNotifier` interface, `MultiChannelNotifier` stub class
//   - guard:    `ApprovalGuard` interface (stub)
//   - policy:   `ApprovalPolicy` interface (stub)
//
// Phase 4.0 is a spike — types and interfaces only, no runtime
// implementation. Phase 4.1 wires the policy and OpenCode
// `allow/ask/deny` mapping; Phase 4.2 wires the DB-backed vault and
// audit log adapter. See `docs/singularity/APPROVALS.md` for the
// architecture decision record.

export * from "./grant.ts";
export * from "./guard.ts";
export * from "./notify.ts";
export * from "./policy.ts";
export * from "./store.ts";
export * from "./vault.ts";
export * from "./vault-db.ts";
