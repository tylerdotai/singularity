// Phase 2.1 — `FactStore` unit tests.
//
// The five `it(...)` blocks below are the IMPLEMENTATION_PLAN Task 2.1
// test-first scenarios (`docs/singularity/IMPLEMENTATION_PLAN.md` lines
// 152-158). Each scenario maps 1:1 to a public method of `FactStore`:
//
//   1. create fact                      → `FactStore.create`
//   2. supersede fact                   → `FactStore.supersede`
//   3. recall excludes superseded       → `FactStore.recall` (default behavior)
//   4. history newest to oldest         → `FactStore.history` (default ordering)
//   5. source_quote required for
//      high-confidence (>= 0.7)        → `FactStore.create` validation
//
// Each test gets a fresh in-memory SQLite via `createTestDb()` in
// `beforeEach`, so the tests are isolated and order-independent.

import { beforeEach, describe, expect, it } from 'bun:test';

import { createTestDb, insertStubSession } from '../../test/db.ts';
import type { FactStore } from './facts.ts';
import type { SessionStore } from './sessions.ts';

describe('FactStore', () => {
  let store: FactStore;
  let sessionStore: SessionStore;

  beforeEach(() => {
    ({ factStore: store, sessionStore } = createTestDb());
    // Migration 004 added a FK on `facts.source_session_id` → `sessions(id)`.
    // Insert stub sessions for the test fixture ids (sess_1, sess_2, sess_3)
    // so the existing fact-insert tests do not violate the constraint.
    insertStubSession(sessionStore, 'sess_1');
    insertStubSession(sessionStore, 'sess_2');
    insertStubSession(sessionStore, 'sess_3');
  });

  it('creates a fact and returns the row with a generated id and created_at', () => {
    const fact = store.create({
      kind: 'decision',
      subject: 'test-subject',
      predicate: 'framework',
      value: 'Hono',
      source_session_id: 'sess_1',
      source_quote: 'We chose Hono because...',
      confidence: 0.5,
    });

    // Generated id is `fact_<32 hex chars>`.
    expect(fact.id.startsWith('fact_')).toBe(true);
    expect(fact.id.length).toBe('fact_'.length + 32);

    // `created_at` is set by `datetime('now')` in the migration's DEFAULT
    // clause; we only assert it's a non-empty string here (its exact format
    // is an SQLite concern, not a FactStore concern).
    expect(typeof fact.created_at).toBe('string');
    expect(fact.created_at.length).toBeGreaterThan(0);

    // Round-tripped fields.
    expect(fact.value).toBe('Hono');
    expect(fact.kind).toBe('decision');
    expect(fact.subject).toBe('test-subject');
    expect(fact.predicate).toBe('framework');
    expect(fact.source_session_id).toBe('sess_1');
    expect(fact.confidence).toBe(0.5);

    // A freshly-created fact has no successor yet.
    expect(fact.superseded_by).toBeNull();
  });

  it("supersedes a fact by setting the predecessor's superseded_by pointer", () => {
    const a = store.create({
      kind: 'decision',
      subject: 'test-subject',
      predicate: 'framework',
      value: 'Express',
      source_session_id: 'sess_1',
      source_quote: 'Initially picked Express.',
      confidence: 0.6,
    });
    const b = store.create({
      kind: 'decision',
      subject: 'test-subject',
      predicate: 'framework',
      value: 'Hono',
      source_session_id: 'sess_2',
      source_quote: 'Switched to Hono for edge runtime.',
      confidence: 0.6,
    });

    store.supersede(a.id, b.id);

    const aAfter = store.getById(a.id);
    expect(aAfter).not.toBeNull();
    expect(aAfter?.superseded_by).toBe(b.id);

    // The successor itself is untouched.
    const bAfter = store.getById(b.id);
    expect(bAfter?.superseded_by).toBeNull();

    // A second supersede on the same predecessor must throw — supersedence
    // is a single-step edge in the append-only DAG.
    expect(() => store.supersede(a.id, b.id)).toThrow(
      /predecessor is already superseded/i
    );
  });

  it('recall excludes superseded facts by default', () => {
    const a = store.create({
      kind: 'decision',
      subject: 'test-subject',
      predicate: 'framework',
      value: 'Express',
      source_session_id: 'sess_1',
      source_quote: 'Initially picked Express.',
      confidence: 0.6,
    });
    const b = store.create({
      kind: 'decision',
      subject: 'test-subject',
      predicate: 'framework',
      value: 'Hono',
      source_session_id: 'sess_2',
      source_quote: 'Switched to Hono for edge runtime.',
      confidence: 0.6,
    });
    store.supersede(a.id, b.id);

    // Default `recall` filters out the tombstoned predecessor.
    const current = store.recall('test-subject');
    expect(current).toHaveLength(1);
    expect(current[0]?.id).toBe(b.id);
    expect(current[0]?.value).toBe('Hono');

    // Opt in to the full timeline (current + tombstoned) for audit views.
    const all = store.recall('test-subject', undefined, {
      includeSuperseded: true,
    });
    expect(all).toHaveLength(2);
    const ids = all.map((f) => f.id);
    expect(ids).toContain(a.id);
    expect(ids).toContain(b.id);
  });

  it('history returns facts newest to oldest', async () => {
    const a = store.create({
      kind: 'decision',
      subject: 'test-subject',
      predicate: 'framework',
      value: 'Express',
      source_session_id: 'sess_1',
      source_quote: 'Initially picked Express.',
      confidence: 0.6,
    });
    // SQLite's `datetime('now')` has second-level resolution; sleep 1.1s
    // between inserts to guarantee a strictly-greater `created_at` for B.
    await new Promise((r) => setTimeout(r, 1100));
    const b = store.create({
      kind: 'decision',
      subject: 'test-subject',
      predicate: 'framework',
      value: 'Hono',
      source_session_id: 'sess_2',
      source_quote: 'Switched to Hono for edge runtime.',
      confidence: 0.6,
    });
    await new Promise((r) => setTimeout(r, 1100));
    const c = store.create({
      kind: 'decision',
      subject: 'test-subject',
      predicate: 'framework',
      value: 'Elysia',
      source_session_id: 'sess_3',
      source_quote: 'Then Elysia after the type-safe validation story.',
      confidence: 0.6,
    });

    const timeline = store.history('test-subject');
    expect(timeline).toHaveLength(3);
    // Newest first: C, B, A.
    expect(timeline[0]?.id).toBe(c.id);
    expect(timeline[1]?.id).toBe(b.id);
    expect(timeline[2]?.id).toBe(a.id);
  }, 10_000);

  it('requires source_quote for high-confidence facts (confidence >= 0.7)', () => {
    const base = {
      kind: 'decision' as const,
      subject: 'test-subject',
      predicate: 'framework',
      value: 'Hono',
      source_session_id: 'sess_1',
    };

    // Confidence 0.9 with empty quote → throws.
    expect(() =>
      store.create({ ...base, confidence: 0.9, source_quote: '' })
    ).toThrow(/source_quote is required for high-confidence/i);

    // Confidence 0.9 with null quote → throws.
    expect(() =>
      store.create({ ...base, confidence: 0.9, source_quote: null })
    ).toThrow(/source_quote is required for high-confidence/i);

    // Confidence 0.9 with whitespace-only quote → throws (the validator
    // trims before checking).
    expect(() =>
      store.create({ ...base, confidence: 0.9, source_quote: '   ' })
    ).toThrow(/source_quote is required for high-confidence/i);

    // Boundary: confidence 0.7 is still "high-confidence" and still throws.
    expect(() =>
      store.create({ ...base, confidence: 0.7, source_quote: '' })
    ).toThrow(/source_quote is required for high-confidence/i);

    // Boundary: confidence 0.6 is below the high-confidence threshold and
    // is allowed to have an empty quote.
    expect(() =>
      store.create({ ...base, confidence: 0.6, source_quote: '' })
    ).not.toThrow();

    // A real quote at high confidence is accepted.
    expect(() =>
      store.create({
        ...base,
        confidence: 0.9,
        source_quote: 'A real source quote from the session transcript.',
      })
    ).not.toThrow();
  });
});
