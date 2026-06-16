// Phase 2.2, Path B — MCP client wrapper for the nlm-memory `get_session`
// tool.
//
// Source of truth: nlm-memory/src/mcp/server.ts:147-195
// (getSessionHandler) and nlm-memory/src/mcp/server.ts:531-547
// (inputSchema registration on the McpServer).
//
// The response is enriched with two lineage fields on top of the raw
// `Session` record (nlm-memory/src/shared/types.ts:21-41):
//   - `supersedes: SessionSupersedesEntry[]`   — IDs of sessions this
//     session supersedes, each enriched with `label` + `summary` for
//     caller context (nlm-memory/src/mcp/server.ts:172-175).
//   - `supersededBy: SessionSupersededByEntry | null` — the ID of the
//     session that superseded this one, enriched with `label` + `summary`
//     plus the optional `reason` and `recordedBy` joined from the
//     supersedence log (nlm-memory/src/mcp/server.ts:176-189).
//
// This module is the **typed client side** of the Phase 2.0 Path B choice
// (consume nlm-memory over MCP, with a fallback Hono server in the same
// process). It mirrors the Phase 2.1 `mcp-recall-facts.ts` pattern: an
// async transport-bound caller that validates the input, throws on
// `isError: true`, and parses the JSON response into the typed
// `SessionDetail`.

import type { McpTransport } from './mcp-recall-facts.ts';

// ---------- Types ----------

/**
 * Lineage entry for a session this session supersedes. The MCP handler
 * enriches the raw `supersedes: string[]` field with `label` + `summary`
 * (nlm-memory/src/mcp/server.ts:172-175).
 */
export interface SessionSupersedesEntry {
  id: string;
  label: string;
  summary: string;
}

/**
 * Lineage entry for the session that superseded this one. On top of
 * `label` + `summary` (mirroring `SessionSupersedesEntry`), the handler
 * joins the `reason` + `recordedBy` fields from the supersedence log
 * (nlm-memory/src/mcp/server.ts:176-189). Both optional fields are
 * omitted when the supersedence log has no entry for this edge.
 */
export interface SessionSupersededByEntry extends SessionSupersedesEntry {
  reason?: string;
  recordedBy?: string;
}

/**
 * Full session detail + lineage returned by the nlm-memory `get_session`
 * MCP tool. Combines the raw `Session` fields (nlm-memory/src/shared/
 * types.ts:21-41) with the lineage enrichment the MCP handler adds
 * (nlm-memory/src/mcp/server.ts:172-191).
 *
 * `transcript_*` fields are nullable because they are populated only when
 * the session has an attached transcript. `body` is nullable for the
 * same reason. `supersededBy` is `null` when this session has not been
 * superseded.
 */
export interface SessionDetail {
  id: string;
  runtime: string;
  runtime_session_id: string | null;
  started_at: string;
  ended_at: string | null;
  duration_min: number | null;
  label: string;
  summary: string;
  body: string | null;
  status: 'active' | 'closed' | 'superseded';
  transcript_kind: string | null;
  transcript_path: string | null;
  transcript_offset: number | null;
  transcript_length: number | null;
  created_at: string;
  updated_at: string;
  supersedes: SessionSupersedesEntry[];
  supersededBy: SessionSupersededByEntry | null;
}

// ---------- Transport-bound caller ----------

/**
 * Call the nlm-memory `get_session` MCP tool over a generic transport.
 *
 * Throws on:
 *   - `id` being empty (caller-side validation — nlm-memory would also
 *     reject it via the Zod `.min(1)` on the input schema, but we fail
 *     fast before the transport round-trip).
 *   - `isError: true` in the response (with the server's error text —
 *     typically `session <id> not found`).
 *   - The first text content being absent.
 *   - The first text content not parsing as JSON.
 *   - The parsed JSON not being a `SessionDetail`-shaped object.
 *
 * Returns the parsed record typed as `SessionDetail`. The cast uses
 * `as unknown as SessionDetail` — we trust the server's schema, not the
 * parsed JSON shape, mirroring `recallFacts` in `mcp-recall-facts.ts`.
 */
export async function getSession(
  transport: McpTransport,
  id: string
): Promise<SessionDetail> {
  if (id === '') {
    throw new Error('getSession: id is required');
  }

  const response = await transport.callTool('get_session', { id });

  if (response.isError === true) {
    const message = response.content[0]?.text ?? 'unknown error';
    throw new Error(`get_session MCP call failed: ${message}`);
  }

  const text = response.content[0]?.text;
  if (text === undefined) {
    throw new Error('get_session: response had no text content');
  }

  const parsed: unknown = JSON.parse(text);

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('get_session: expected object, got non-object');
  }

  const record = parsed as Record<string, unknown>;
  if (typeof record.id !== 'string' || typeof record.label !== 'string') {
    throw new Error('get_session: response missing required id/label fields');
  }

  return parsed as unknown as SessionDetail;
}
