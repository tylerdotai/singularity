// Phase 2.2, Path B — MCP client wrapper for the nlm-memory `recall_sessions`
// tool.
//
// Source of truth: nlm-memory/src/mcp/server.ts:90-145 (RecallToolInput +
// recallSessionsHandler) and nlm-memory/src/mcp/server.ts:485-529
// (inputSchema registration on the McpServer).
//
// This module is the **typed client side** of the Phase 2.0 Path B choice
// (consume nlm-memory over MCP, with a fallback Hono server in the same
// process). It mirrors the Phase 2.1 `mcp-recall-facts.ts` pattern: a pure
// builder that produces the exact input shape nlm-memory's MCP
// `recall_sessions` tool expects, plus an async transport-bound caller that
// parses the JSON response into `SessionDigest[]`.
//
// Defaults match nlm-memory's MCP server (src/mcp/server.ts:90-97 + 485-529):
//   - `mode: "hybrid"`        — server's RecallQuery default
//   - `limit: 10`             — DEFAULT_LIMIT in nlm-memory
//   - `rewrite: true`         — MCP callers default to rewrite=true per
//                               `mcpRewriteDefault` (src/mcp/server.ts:99-106)
//   - `entity`, `kind`        — pass-through filters; omitted from the wire
//                               payload when the caller does not set them.

import type { McpTransport } from './mcp-recall-facts.ts';

// ---------- Types ----------

/**
 * Matches nlm-memory's `recall_sessions` tool input schema
 * (nlm-memory/src/mcp/server.ts:485-529). All fields are optional on the
 * type because the server's Zod schema marks them `.optional()` /
 * `.default(...)`; the server fills in defaults when a field is missing.
 */
export interface RecallSessionsToolInput {
  query?: string;
  entity?: string;
  kind?: 'decision' | 'open';
  mode?: 'keyword' | 'semantic' | 'hybrid';
  limit?: number;
  rewrite?: boolean;
}

/**
 * Slimmer than nlm-memory's full `Session` interface (shared/types.ts:21-41) —
 * only the fields the agent actually consumes in a recall pointer block.
 * The shape is a snake-cased projection: `started_at`, `ended_at`,
 * `decisions`, `open_questions`, `superseded_by`. `superseded_by` and the
 * inline `decisions` / `open_questions` arrays are optional because
 * nlm-memory omits them when not relevant to the hit.
 *
 * `status` is narrowed to the three values the agent's pointer block
 * renders: `"active" | "closed" | "superseded"`. nlm-memory's full
 * `SessionStatus` union also includes `"idle" | "replaced"`, but those
 * are filtered out before this shape reaches the recall output.
 */
export interface SessionDigest {
  id: string;
  runtime: string;
  label: string;
  summary: string;
  started_at: string;
  ended_at: string | null;
  status: 'active' | 'closed' | 'superseded';
  superseded_by?: string | null;
  decisions?: string[];
  open_questions?: string[];
}

/**
 * Optional recall options. Mirrors `McpRecallOptions` in
 * `mcp-recall-facts.ts` but adds the `recall_sessions`-specific knobs:
 * `entity`, `kind`, and `rewrite`. `mode` and `limit` are shared with the
 * facts wrapper.
 */
export interface McpRecallSessionsOptions {
  entity?: string;
  kind?: 'decision' | 'open';
  mode?: 'keyword' | 'semantic' | 'hybrid';
  limit?: number;
  rewrite?: boolean;
}

// ---------- Pure builder ----------

/**
 * Build the input payload for the nlm-memory `recall_sessions` MCP tool.
 *
 * Defaults match nlm-memory's MCP server defaults (src/mcp/server.ts:91-97
 * + 99-106):
 *   - `mode: "hybrid"`
 *   - `limit: 10`
 *   - `rewrite: true`  (MCP callers' rewrite default per mcpRewriteDefault)
 *
 * `query` is required as a positional argument here, but the field is
 * optional in the output type because the server treats it as optional
 * (a caller can filter by `entity` or `kind` alone). If the caller passes
 * an empty string, the empty string is included in the output (matches
 * the server's `.default("")` behavior).
 *
 * `entity` and `kind` are optional pass-throughs; they are only included
 * in the output when the caller sets them, so the wire payload stays
 * minimal for the common query-only case.
 *
 * The function is pure — no IO, no side effects, no `Date.now()` or
 * `process.env` reads. The `rewrite: true` default is a hard-coded
 * mirror of `mcpRewriteDefault()`; the env-var override lives on the
 * server side and is not replicated here.
 */
export function buildRecallSessionsInput(
  query: string,
  options?: McpRecallSessionsOptions
): RecallSessionsToolInput {
  const input: RecallSessionsToolInput = {
    query,
    mode: options?.mode ?? 'hybrid',
    limit: options?.limit ?? 10,
    rewrite: options?.rewrite ?? true,
  };

  if (options?.entity !== undefined) {
    input.entity = options.entity;
  }
  if (options?.kind !== undefined) {
    input.kind = options.kind;
  }

  return input;
}

// ---------- Transport-bound caller ----------

/**
 * Call the nlm-memory `recall_sessions` MCP tool over a generic transport.
 *
 * Throws on:
 *   - `isError: true` in the response (with the server's error text).
 *   - The first text content being absent.
 *   - The first text content not parsing as JSON.
 *   - The parsed JSON not matching either the `{ results, total }` shape
 *     or a bare `SessionDigest[]`.
 *
 * Returns the parsed hit set wrapped with its `total`. The cast uses
 * `as unknown as SessionDigest[]` — we trust the server's schema, not the
 * parsed JSON shape, mirroring `recallFacts` in `mcp-recall-facts.ts`.
 */
export async function recallSessions(
  transport: McpTransport,
  query: string,
  options?: McpRecallSessionsOptions
): Promise<{ results: SessionDigest[]; total: number }> {
  const input = buildRecallSessionsInput(query, options);

  const response = await transport.callTool('recall_sessions', input);

  if (response.isError === true) {
    const message = response.content[0]?.text ?? 'unknown error';
    throw new Error(`recall_sessions MCP call failed: ${message}`);
  }

  const text = response.content[0]?.text;
  if (text === undefined) {
    throw new Error('recall_sessions: response had no text content');
  }

  const parsed: unknown = JSON.parse(text);

  if (Array.isArray(parsed)) {
    const results = parsed as unknown as SessionDigest[];
    return { results, total: results.length };
  }

  if (
    typeof parsed === 'object' &&
    parsed !== null &&
    'results' in parsed &&
    'total' in parsed
  ) {
    const wrapped = parsed as { results: SessionDigest[]; total: number };
    return wrapped;
  }

  throw new Error('recall_sessions: unexpected response shape');
}
