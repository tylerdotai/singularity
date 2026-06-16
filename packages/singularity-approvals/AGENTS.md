# singularity-approvals

Edge package for approval grants and multi-channel human authorization.
Phase 20 reflects **full implementation** — the package contains runtime implementation including DB-backed `approvals` table, audit log adapter, and policy engine. See `docs/singularity/APPROVALS.md` for the architecture decision record.

## What this package does (Phase 20)

- Exports `Grant`, `GrantRequest`, and `GrantEffect` from `src/grant.ts`
- Exports `GrantVault` interface + `InMemoryGrantVault` stub from `src/vault.ts`
- Exports `ApprovalNotifier` interface + `MultiChannelNotifier` stub from `src/notify.ts`
- Exports `ApprovalGuard` interface stub from `src/guard.ts`
- Exports `ApprovalPolicy` interface stub from `src/policy.ts`
- Re-exports the full public surface from `src/index.ts`
- Does NOT include any tests in Phase 4.0 (spike)

## Approval grant concepts

`src/grant.ts` defines the core vocabulary:

- `GrantEffect` — the effect a grant conveys: `'allow' | 'deny'`
- `Grant` — a granted permission (id, sessionId, action, resource, effect,
  grantedBy, grantedAt, optional expiresAt / scope / metadata)
- `GrantRequest` — what the agent wants to do (sessionId, action, resource,
  optional reason, requestedAt)

The 9-field `Grant` interface is the canonical row shape for the future
`approvals` table defined in `docs/singularity/ARCHITECTURE.md` lines 152-163.

## Grant vault

`src/vault.ts` defines the storage abstraction:

- `GrantVault` — interface with 6 methods: `store`, `get`, `list`, `revoke`,
  `purgeExpired`, `check`
- `InMemoryGrantVault` — Map-backed stub. Phase 4.2 replaces this with a
  DB-backed implementation that writes to the `approvals` table.

`purgeExpired()` iterates and deletes grants where `expiresAt < now`.
`check(request)` finds the first non-expired grant whose `action` and
`resource` match the request's `action` and `resource`.

Phase 4.3 adds `SqliteGrantVault` (`src/vault-db.ts`) — the production
DB-backed implementation of `GrantVault`. It reuses the `approvals` table
from Phase 4.2, mapping `Grant` fields onto table columns (`effect` →
`decision`, `expiresAt` → `reason`, `grantedAt` → `decided_at`,
`scope` → `save_rule`). `InMemoryGrantVault` stays for tests that need a
no-persistence fixture.

## Multi-channel notification

`src/notify.ts` defines the notification fan-out:

- `ApprovalNotifier` — single channel (CLI prompt, Telegram, Discord, etc.)
  with a `name` and a `notify(request)` method
- `MultiChannelNotifier` — wraps `readonly ApprovalNotifier[]` and fans
  out via `Promise.all(notifiers.map(n => n.notify(request)))`

The 4.0 stub iterates and awaits all channels. Phase 8 will register
Telegram and Discord adapters against this interface.

## Guard + policy

`src/guard.ts` and `src/policy.ts` define the orchestration interfaces:

- `ApprovalGuard` — `guard<T>(request, operation): Promise<T>` wrapper that
  checks the vault, requests approval if needed, and runs the operation
- `ApprovalPolicy` — `request(request): Promise<Grant>` top-level entry
  point that combines vault + notifier + guard

Both are interfaces only in Phase 4.0. Phase 4.1 wires the policy
implementation; Phase 4.2 wires the audit log adapter.

## What this package does NOT do (yet)

- No runtime policy implementation (Phase 4.1)
- No DB-backed vault — `InMemoryGrantVault` is a Map stub (Phase 4.2)
- No `approvals` table migration (Phase 4.2)
- No audit log adapter (Phase 4.2)
- No OpenCode `allow/ask/deny` mapping (Phase 4.1)
- No TUI/CLI for approval workflow (Phase 7)
- No gateway adapters — no Telegram, Discord, or email (Phase 8)
- No `bin` field — the `singularity` binary lands in Phase 7
- No tests in Phase 4.0 (spike) — the 35-test PVM benchmark is a
  reference, not a target
- No new dependencies; the package is self-contained

## Conventions

- No dependencies on `@opencode-ai/*`, `nlm-memory`, `@modelcontextprotocol/sdk`,
  `ollama`, `openai`, or `anthropic`. The package must be self-contained.
- No `bin` field until Phase 7.
- All public API changes go through `src/index.ts` re-exports.
- Version bumps follow the convention `0.1.0-phase-N.M` until Phase 1.0.
- All types are `readonly` to keep `Grant` and `GrantRequest` immutable
  once handed to the vault.
