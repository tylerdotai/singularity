// Phase 4.2 approvals audit log — SQLite-backed ledger for policy decisions.
//
// Task 2.3 of the Phase 4.2 plan. Provides the durable record of every
// decision the policy engine renders against a tool call. Sits on top of
// the `approvals` table defined in `schema.sql.ts` (Task 2.1) and pairs
// with the `ApprovalPolicy` evaluator in `policy.ts`.
//
// Public surface:
//   - `ApprovalAuditEntry` — the row shape persisted in `approvals`.
//   - `AuditFilter` — query-side filter for `SqliteApprovalAuditLog.query`.
//   - `ApprovalAuditLog` — the storage interface callers depend on.
//   - `SqliteApprovalAuditLog` — the default `bun:sqlite`-backed impl.
//
// Conventions:
//   - Dates are stored as ISO-8601 strings in TEXT columns; the audit log
//     serialises to/from `Date` at the boundary so callers never touch
//     raw strings.
//   - `metadataJson` is opaque to this module: the caller serialises to
//     a JSON string, the module stores and returns the string verbatim.
//     Parsing is the caller's responsibility (the policy layer is the
//     authoritative producer/consumer of metadata).
//   - `record()` uses `INSERT OR REPLACE` so re-rendering the same
//     decision (e.g. retry after a transient write failure) is idempotent
//     and does not duplicate rows in the ledger.
//   - `query()` AND-combines any non-undefined `AuditFilter` fields and
//     orders results by `decided_at DESC` (newest first), which is the
//     direction every Phase 4 consumer (CLI history, dashboard) wants.

import type { Database } from 'bun:sqlite';

import type { PolicyDecision } from './risk.ts';

export type ApprovalAuditEntry = {
  readonly id: string;
  readonly sessionId: string;
  readonly action: string;
  readonly resource?: string;
  readonly effectRequested: string;
  readonly decision: PolicyDecision;
  readonly decidedBy: string;
  readonly decidedAt: Date;
  readonly saveRule: 'once' | 'saved';
  readonly reason: string;
  readonly metadataJson?: string;
};

export type AuditFilter = {
  readonly sessionId?: string;
  readonly action?: string;
  readonly decision?: PolicyDecision;
  readonly since?: Date;
  readonly until?: Date;
};

export interface ApprovalAuditLog {
  record(entry: ApprovalAuditEntry): Promise<void>;
  getById(id: string): Promise<ApprovalAuditEntry | undefined>;
  query(filter?: AuditFilter): Promise<ApprovalAuditEntry[]>;
}

type ApprovalRow = {
  id: string;
  session_id: string;
  action: string;
  resource: string | null;
  effect_requested: string;
  decision: string;
  decided_by: string;
  decided_at: string;
  reason: string | null;
  save_rule: string;
  metadata_json: string | null;
};

function rowToEntry(row: ApprovalRow): ApprovalAuditEntry {
  return {
    id: row.id,
    sessionId: row.session_id,
    action: row.action,
    effectRequested: row.effect_requested,
    decision: row.decision as PolicyDecision,
    decidedBy: row.decided_by,
    decidedAt: new Date(row.decided_at),
    saveRule: row.save_rule as 'once' | 'saved',
    reason: row.reason ?? '',
    ...(row.resource !== null ? { resource: row.resource } : {}),
    ...(row.metadata_json !== null ? { metadataJson: row.metadata_json } : {}),
  };
}

export class SqliteApprovalAuditLog implements ApprovalAuditLog {
  constructor(private db: Database) {}

  record(entry: ApprovalAuditEntry): Promise<void> {
    const statement = this.db.prepare(
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
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    statement.run(
      entry.id,
      entry.sessionId,
      entry.action,
      entry.resource ?? null,
      entry.effectRequested,
      entry.decision,
      entry.decidedBy,
      entry.decidedAt.toISOString(),
      entry.reason,
      entry.saveRule,
      entry.metadataJson ?? null
    );
    return Promise.resolve();
  }

  getById(id: string): Promise<ApprovalAuditEntry | undefined> {
    const statement = this.db.prepare(
      'SELECT id, session_id, action, resource, effect_requested, decision, decided_by, decided_at, reason, save_rule, metadata_json FROM approvals WHERE id = ?'
    );
    const row = statement.get(id) as ApprovalRow | undefined;
    return Promise.resolve(row ? rowToEntry(row) : undefined);
  }

  query(filter?: AuditFilter): Promise<ApprovalAuditEntry[]> {
    const clauses: string[] = [];
    const params: (string | number)[] = [];

    if (filter !== undefined) {
      if (filter.sessionId !== undefined) {
        clauses.push('session_id = ?');
        params.push(filter.sessionId);
      }
      if (filter.action !== undefined) {
        clauses.push('action = ?');
        params.push(filter.action);
      }
      if (filter.decision !== undefined) {
        clauses.push('decision = ?');
        params.push(filter.decision);
      }
      if (filter.since !== undefined) {
        clauses.push('decided_at >= ?');
        params.push(filter.since.toISOString());
      }
      if (filter.until !== undefined) {
        clauses.push('decided_at <= ?');
        params.push(filter.until.toISOString());
      }
    }

    const whereClause =
      clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const sql = `SELECT id, session_id, action, resource, effect_requested, decision, decided_by, decided_at, reason, save_rule, metadata_json FROM approvals ${whereClause} ORDER BY decided_at DESC`;

    const statement = this.db.prepare(sql);
    const rows = statement.all(...params) as ApprovalRow[];
    return Promise.resolve(rows.map(rowToEntry));
  }
}
