// Phase 4.2 — `SqliteApprovalAuditLog` unit tests.
//
// The six `it(...)` blocks below are the IMPLEMENTATION_PLAN Task 2.4
// test-first scenarios (`docs/singularity/IMPLEMENTATION_PLAN.md` Task 2.4):
//
//   1. record stores and getById retrieves  → round-trip via `record` + `getById`
//   2. query by sessionId                   → `query({ sessionId })`
//   3. query by action                      → `query({ action })`
//   4. query by decision                    → `query({ decision })`
//   5. query by date range                  → `query({ since, until })`
//   6. idempotent upsert                    → second `record` with same id replaces
//
// Each test gets a fresh in-memory `bun:sqlite` database in `beforeEach`
// and applies `APPROVALS_TABLE_SQL` directly — the audit log is a leaf
// table, so the table DDL from `schema.sql.ts` is the only schema the
// fixture needs. (Indexes from migration 006 are not required for the
// 5–10-row fixtures here; correctness does not depend on them.)
//
// Conventions:
//   - `bun:test` is referenced via its module form here (the file is
//     the only place in `src/approvals/` that imports from `bun:test`);
//     `bun-globals.d.ts` exposes the same names as globals so the rest
//     of the package can stay free of test imports.
//   - All `decided_at` timestamps are constructed deterministically so
//     the date-range assertion (test 5) does not race the system clock
//     and the `ORDER BY decided_at DESC` ordering is verifiable by index.

import { Database } from 'bun:sqlite';
import { beforeEach, describe, expect, it } from 'bun:test';

import { type ApprovalAuditEntry, SqliteApprovalAuditLog } from './audit.ts';
import { APPROVALS_TABLE_SQL } from './schema.sql.ts';

function makeEntry(
  overrides: Partial<ApprovalAuditEntry> = {}
): ApprovalAuditEntry {
  return {
    id: 'apr_1',
    sessionId: 'sess_alpha',
    action: 'read:file',
    effectRequested: 'read',
    decision: 'allow',
    decidedBy: 'auto',
    decidedAt: new Date('2026-06-01T10:00:00Z'),
    saveRule: 'once',
    reason: 'safe read',
    ...overrides,
  };
}

describe('SqliteApprovalAuditLog', () => {
  let db: Database;
  let log: SqliteApprovalAuditLog;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(APPROVALS_TABLE_SQL);
    log = new SqliteApprovalAuditLog(db);
  });

  it('record stores and getById retrieves the entry', async () => {
    const entry = makeEntry({
      id: 'apr_round_trip',
      resource: '/tmp/hello.txt',
      metadataJson: '{"matched_rule":"safe_read"}',
    });

    await log.record(entry);

    const fetched = await log.getById('apr_round_trip');
    expect(fetched).toBeDefined();
    expect(fetched?.id).toBe('apr_round_trip');
    expect(fetched?.sessionId).toBe('sess_alpha');
    expect(fetched?.action).toBe('read:file');
    expect(fetched?.resource).toBe('/tmp/hello.txt');
    expect(fetched?.effectRequested).toBe('read');
    expect(fetched?.decision).toBe('allow');
    expect(fetched?.decidedBy).toBe('auto');
    // Round-tripped as a Date instance; the schema stores ISO-8601 TEXT.
    expect(fetched?.decidedAt).toBeInstanceOf(Date);
    expect(fetched?.decidedAt.toISOString()).toBe('2026-06-01T10:00:00.000Z');
    expect(fetched?.saveRule).toBe('once');
    expect(fetched?.reason).toBe('safe read');
    expect(fetched?.metadataJson).toBe('{"matched_rule":"safe_read"}');
  });

  it('query by sessionId returns only matching session entries', async () => {
    await log.record(makeEntry({ id: 'a1', sessionId: 'sess_alpha' }));
    await log.record(makeEntry({ id: 'a2', sessionId: 'sess_alpha' }));
    await log.record(makeEntry({ id: 'b1', sessionId: 'sess_beta' }));

    const alpha = await log.query({ sessionId: 'sess_alpha' });
    expect(alpha).toHaveLength(2);
    expect(alpha.every((e) => e.sessionId === 'sess_alpha')).toBe(true);
    const ids = alpha.map((e) => e.id).sort();
    expect(ids).toEqual(['a1', 'a2']);

    const beta = await log.query({ sessionId: 'sess_beta' });
    expect(beta).toHaveLength(1);
    expect(beta[0]?.id).toBe('b1');

    // Unknown session yields an empty result, not an error.
    const none = await log.query({ sessionId: 'sess_gamma' });
    expect(none).toHaveLength(0);
  });

  it('query by action returns only matching action entries', async () => {
    await log.record(makeEntry({ id: 'r1', action: 'read:file' }));
    await log.record(makeEntry({ id: 'r2', action: 'read:file' }));
    await log.record(makeEntry({ id: 'w1', action: 'write:file' }));
    await log.record(makeEntry({ id: 'd1', action: 'delete:file' }));

    const reads = await log.query({ action: 'read:file' });
    expect(reads).toHaveLength(2);
    expect(reads.every((e) => e.action === 'read:file')).toBe(true);

    const deletes = await log.query({ action: 'delete:file' });
    expect(deletes).toHaveLength(1);
    expect(deletes[0]?.id).toBe('d1');

    const writes = await log.query({ action: 'write:file' });
    expect(writes).toHaveLength(1);
    expect(writes[0]?.id).toBe('w1');
  });

  it('query by decision returns only matching decision entries', async () => {
    await log.record(makeEntry({ id: 'allow_1', decision: 'allow' }));
    await log.record(makeEntry({ id: 'ask_1', decision: 'ask' }));
    await log.record(makeEntry({ id: 'ask_2', decision: 'ask' }));
    await log.record(makeEntry({ id: 'deny_1', decision: 'deny' }));

    const allows = await log.query({ decision: 'allow' });
    expect(allows).toHaveLength(1);
    expect(allows[0]?.id).toBe('allow_1');

    const asks = await log.query({ decision: 'ask' });
    expect(asks).toHaveLength(2);
    expect(asks.every((e) => e.decision === 'ask')).toBe(true);

    const denies = await log.query({ decision: 'deny' });
    expect(denies).toHaveLength(1);
    expect(denies[0]?.id).toBe('deny_1');
  });

  it('query by date range respects since and until bounds', async () => {
    // Three entries at distinct timestamps; query for the middle one.
    await log.record(
      makeEntry({ id: 'early', decidedAt: new Date('2026-06-01T08:00:00Z') })
    );
    await log.record(
      makeEntry({ id: 'mid', decidedAt: new Date('2026-06-01T12:00:00Z') })
    );
    await log.record(
      makeEntry({ id: 'late', decidedAt: new Date('2026-06-01T16:00:00Z') })
    );

    // `since` only — everything at or after 10:00.
    const sinceOnly = await log.query({
      since: new Date('2026-06-01T10:00:00Z'),
    });
    expect(sinceOnly.map((e) => e.id)).toEqual(['late', 'mid']);

    // `until` only — everything at or before 14:00.
    const untilOnly = await log.query({
      until: new Date('2026-06-01T14:00:00Z'),
    });
    expect(untilOnly.map((e) => e.id)).toEqual(['mid', 'early']);

    // Both — the middle entry only.
    const window = await log.query({
      since: new Date('2026-06-01T10:00:00Z'),
      until: new Date('2026-06-01T14:00:00Z'),
    });
    expect(window.map((e) => e.id)).toEqual(['mid']);
  });

  it('idempotent upsert: re-recording the same id replaces, not duplicates', async () => {
    const first = makeEntry({
      id: 'apr_idem',
      decision: 'ask',
      reason: 'first ask',
    });
    await log.record(first);

    const second = makeEntry({
      id: 'apr_idem',
      decision: 'deny',
      reason: 'escalated to deny',
    });
    await log.record(second);

    // Only one row exists for this id (the upsert replaced, not appended).
    const all = await log.query();
    expect(all).toHaveLength(1);

    const fetched = await log.getById('apr_idem');
    expect(fetched?.decision).toBe('deny');
    expect(fetched?.reason).toBe('escalated to deny');
  });
});
