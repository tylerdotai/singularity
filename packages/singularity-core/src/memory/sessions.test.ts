// Phase 2.2 — `SessionStore` unit tests.
//
// The five `it(...)` blocks below cover the four
// IMPLEMENTATION_PLAN Task 2.2 test-first scenarios
// (`docs/singularity/IMPLEMENTATION_PLAN.md` lines 182-187) plus a
// bonus scenario for `markSuperseded`:
//
//   1. session digest search              → `SessionStore.searchDigests`
//                                            (asserts `body` is NOT returned)
//   2. full session load                  → `SessionStore.getById`
//                                            (asserts `body` IS returned)
//   3. source / platform filtering        → `SessionStore.searchByRuntime`
//   4. parent / child lineage handling    → `SessionStore.addEdge` +
//                                            `SessionStore.getLineage`
//   5. BONUS: markSuperseded              → `SessionStore.markSuperseded`
//                                            (status flip + edge)
//
// Each test gets a fresh in-memory SQLite via `createTestDb()` in
// `beforeEach`, so the tests are isolated and order-independent.

import { beforeEach, describe, expect, it } from 'bun:test';

import { createTestDb } from '../../test/db.ts';
import type { SessionStore } from './sessions.ts';

describe('SessionStore', () => {
  let store: SessionStore;

  beforeEach(() => {
    ({ sessionStore: store } = createTestDb());
  });

  // IMPLEMENTATION_PLAN scenario 1: session digest search.
  // Digests must NOT include the full `body` — the digest payload stays
  // small (label + summary + metadata) so recall-time search does not
  // pay the cost of loading every transcript body.
  it('searchDigests finds sessions by label/summary keyword and omits the body field', () => {
    store.upsert({
      id: 'sess_hono',
      runtime: 'opencode',
      started_at: '2026-06-13T00:00:00Z',
      label: 'Hono framework session',
      summary: 'Discussed Hono routing',
      body: 'long markdown body that must not appear in digests...',
    });
    store.upsert({
      id: 'sess_express',
      runtime: 'opencode',
      started_at: '2026-06-12T00:00:00Z',
      label: 'Express framework session',
      summary: 'Discussed Express middleware',
      body: 'long markdown body that must not appear in digests...',
    });
    store.upsert({
      id: 'sess_unrelated',
      runtime: 'opencode',
      started_at: '2026-06-11T00:00:00Z',
      label: 'Unrelated session',
      summary: 'About something else entirely',
      body: 'long markdown body that must not appear in digests...',
    });

    const digests = store.searchDigests({ query: 'Hono' });

    expect(digests).toHaveLength(1);
    expect(digests[0]?.id).toBe('sess_hono');
    // CRITICAL: digests do NOT include the body field. The transcript
    // is loaded lazily via `getById()` when a caller actually needs it.
    expect(digests[0]?.body).toBeUndefined();
    // Other digest fields are present.
    expect(digests[0]?.label).toBe('Hono framework session');
    expect(digests[0]?.summary).toBe('Discussed Hono routing');
  });

  // IMPLEMENTATION_PLAN scenario 2: full session load.
  // `getById` is the lazy-load companion to `searchDigests` — it returns
  // the full row including the `body` field.
  it('getById returns the full session including the body', () => {
    const longBody =
      'This is a long transcript body with multiple paragraphs.\n\n' +
      'It includes the entire conversation, tool calls, and results.';
    const upserted = store.upsert({
      id: 'sess_full',
      runtime: 'opencode',
      started_at: '2026-06-13T00:00:00Z',
      label: 'Full session',
      summary: 'Test session for full-load',
      body: longBody,
    });

    const got = store.getById('sess_full');

    expect(got).not.toBeNull();
    expect(got?.body).toBe(longBody);
    expect(got?.id).toBe(upserted.id);
    expect(got?.label).toBe('Full session');
    expect(got?.runtime).toBe('opencode');

    // A non-existent id returns null rather than throwing.
    expect(store.getById('sess_does_not_exist')).toBeNull();
  });

  // IMPLEMENTATION_PLAN scenario 3: source / platform filtering.
  // `searchByRuntime` returns FULL sessions (with body) for a given
  // runtime — callers using it typically want the whole timeline.
  it('searchByRuntime filters on the runtime column and returns full sessions', () => {
    store.upsert({
      id: 'sess_oc1',
      runtime: 'opencode',
      started_at: '2026-06-13T00:00:00Z',
      label: 'OC 1',
      summary: 'opencode session one',
      body: 'opencode body one',
    });
    store.upsert({
      id: 'sess_oc2',
      runtime: 'opencode',
      started_at: '2026-06-12T00:00:00Z',
      label: 'OC 2',
      summary: 'opencode session two',
      body: 'opencode body two',
    });
    store.upsert({
      id: 'sess_cc1',
      runtime: 'claude-code',
      started_at: '2026-06-11T00:00:00Z',
      label: 'CC 1',
      summary: 'claude-code session',
      body: 'claude-code body',
    });

    const opencodeSessions = store.searchByRuntime('opencode');

    expect(opencodeSessions).toHaveLength(2);
    expect(opencodeSessions.every((s) => s.runtime === 'opencode')).toBe(true);
    // The two opencode sessions are present (order-independent check).
    const ids = opencodeSessions.map((s) => s.id).sort();
    expect(ids).toEqual(['sess_oc1', 'sess_oc2']);
    // `searchByRuntime` returns FULL sessions (with body) — the digest/body
    // split is a `searchDigests` concern, not a `searchByRuntime` concern.
    expect(opencodeSessions[0]?.body).not.toBeNull();

    // A runtime with no sessions returns an empty array.
    expect(store.searchByRuntime('hermes')).toHaveLength(0);
  });

  // IMPLEMENTATION_PLAN scenario 4: parent / child lineage handling.
  // The lineage DAG has 4 edge kinds (supersedes, continues,
  // branched_from, merged_from). `getLineage` walks the graph with a
  // directional filter.
  it('getLineage returns parent/child edges in both directions', () => {
    store.upsert({
      id: 'sess_a',
      runtime: 'opencode',
      started_at: '2026-06-10T00:00:00Z',
      label: 'A',
      summary: 'first',
    });
    store.upsert({
      id: 'sess_b',
      runtime: 'opencode',
      started_at: '2026-06-11T00:00:00Z',
      label: 'B',
      summary: 'second',
    });
    store.upsert({
      id: 'sess_c',
      runtime: 'opencode',
      started_at: '2026-06-12T00:00:00Z',
      label: 'C',
      summary: 'third',
    });

    // A → B → C lineage.
    store.addEdge('sess_a', 'sess_b', 'continues');
    store.addEdge('sess_b', 'sess_c', 'continues');

    // From B's perspective: 1 incoming (from A) + 1 outgoing (to C) = 2 edges.
    const lineageFromB = store.getLineage('sess_b');
    expect(lineageFromB).toHaveLength(2);
    // Both edges are `continues` kind.
    expect(lineageFromB.every((e) => e.kind === 'continues')).toBe(true);

    // Direction: "children" from A returns only the A→B edge.
    const childrenOfA = store.getLineage('sess_a', {
      direction: 'children',
    });
    expect(childrenOfA).toHaveLength(1);
    expect(childrenOfA[0]?.from_session).toBe('sess_a');
    expect(childrenOfA[0]?.to_session).toBe('sess_b');
    expect(childrenOfA[0]?.kind).toBe('continues');

    // Direction: "parents" from C returns only the B→C edge.
    const parentsOfC = store.getLineage('sess_c', {
      direction: 'parents',
    });
    expect(parentsOfC).toHaveLength(1);
    expect(parentsOfC[0]?.from_session).toBe('sess_b');
    expect(parentsOfC[0]?.to_session).toBe('sess_c');
    expect(parentsOfC[0]?.kind).toBe('continues');

    // A node with no edges returns an empty array.
    expect(store.getLineage('sess_unrelated')).toHaveLength(0);
  });

  // Bonus scenario: `markSuperseded` flips the predecessor's status to
  // `superseded` AND records a `supersedes` lineage edge to the successor.
  // This is the supersedence counterpart to `FactStore.supersede` for
  // session rows.
  it('markSuperseded flips the predecessor status and records the supersedes edge', () => {
    store.upsert({
      id: 'sess_old',
      runtime: 'opencode',
      started_at: '2026-06-10T00:00:00Z',
      label: 'Old',
      summary: 'old session',
    });
    store.upsert({
      id: 'sess_new',
      runtime: 'opencode',
      started_at: '2026-06-11T00:00:00Z',
      label: 'New',
      summary: 'new session',
    });

    store.markSuperseded({
      predecessorId: 'sess_old',
      successorId: 'sess_new',
    });

    // The predecessor's status is now 'superseded'.
    const after = store.getById('sess_old');
    expect(after?.status).toBe('superseded');

    // The successor's status is unchanged.
    const successor = store.getById('sess_new');
    expect(successor?.status).toBe('active');

    // The supersedence edge is recorded.
    const edges = store.getEdges('sess_old', 'supersedes');
    expect(edges).toHaveLength(1);
    expect(edges[0]?.from_session).toBe('sess_old');
    expect(edges[0]?.to_session).toBe('sess_new');
    expect(edges[0]?.kind).toBe('supersedes');
  });
});
