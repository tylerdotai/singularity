// Phase 2.1 — MCP client wrapper for the nlm-memory `recall_facts` tool.
//
// Source of truth: nlm-memory/src/mcp/server.ts:555-593 (inputSchema) and
// nlm-memory/src/mcp/server.ts:197-206 (RecallFactsInput type).
//
// This module is the **typed client side** of the Phase 2.0 Path B choice
// (consume nlm-memory over MCP, with a fallback Hono server in the same
// process). The wrapper takes a Singularity `ProfileContext` and a query,
// produces the exact input shape nlm-memory's MCP `recall_facts` tool
// expects, and parses the JSON response into `FactResult[]`.
//
// Per Phase 2.0 follow-up #1 (docs/singularity/NLM_INTEGRATION.md line 216),
// the install-scope filter is recorded on the profile but NOT encoded into
// the wire input yet. The actual install-scope filter is applied by a later
// phase that wraps the MCP server itself; this wrapper is the typed client
// surface that phase will hand the filter off to.

// ---------- Types ----------

/**
 * Matches nlm-memory's `recall_facts` tool input schema (8 fields).
 * All fields are optional on the type because nlm-memory's Zod schema marks
 * them `.optional()` / `.default(...)` — the server fills in defaults when
 * the field is missing.
 */
export interface RecallFactsToolInput {
  query?: string;
  subject?: string;
  predicate?: string;
  kind?: 'decision' | 'open' | 'attribute';
  mode?: 'keyword' | 'semantic' | 'hybrid';
  includeSuperseded?: boolean;
  minConfidence?: number;
  limit?: number;
}

/**
 * Slimmer than `Fact` (defined in facts.ts) — only the fields the agent
 * actually consumes in recall output. `corroborationCount` and
 * `superseded_by` are optional because nlm-memory omits them when not
 * relevant to the recall result.
 */
export interface FactResult {
  id: string;
  kind: 'decision' | 'open' | 'attribute';
  subject: string;
  predicate: string;
  value: string;
  confidence: number;
  source_session_id: string;
  source_quote: string | null;
  created_at: string;
  superseded_by?: string | null;
  corroborationCount?: number;
}

/**
 * Minimal transport interface. A live `@modelcontextprotocol/sdk` client
 * implements this; a mock in tests also implements this. We deliberately
 * do NOT import the SDK — this wrapper is the seam where a real transport
 * gets plugged in during Phase 2.1 wiring.
 */
export interface McpTransport {
  callTool(
    name: string,
    input: unknown
  ): Promise<{
    content: Array<{ type: 'text'; text: string }>;
    isError?: boolean;
  }>;
}

/**
 * Singularity-side identity context. `profileId` is the agent's identity
 * in Singularity; `installScope` is the nlm-memory install the profile is
 * bound to. The install-scope filter is recorded here but not yet encoded
 * into the wire input — see the file header.
 */
export interface ProfileContext {
  profileId: string;
  installScope?: string;
}

/**
 * Optional recall options. Mirrors `RecallOptions` in facts.ts but adds
 * the `subject`, `predicate`, `kind`, and `mode` knobs that the MCP
 * `recall_facts` tool exposes on top of the local recall API.
 */
export interface McpRecallOptions {
  subject?: string;
  predicate?: string;
  kind?: 'decision' | 'open' | 'attribute';
  mode?: 'keyword' | 'semantic' | 'hybrid';
  includeSuperseded?: boolean;
  minConfidence?: number;
  limit?: number;
}

// ---------- Pure builders ----------

/**
 * Build the input payload for the nlm-memory `recall_facts` MCP tool.
 *
 * Defaults match nlm-memory's MCP server defaults (src/mcp/server.ts:557-592):
 *   - `query` defaults to `""` on the server when omitted
 *   - `mode` defaults to `"hybrid"`
 *   - `includeSuperseded` defaults to `false`
 *   - `minConfidence` defaults to `0.6`
 *   - `limit` defaults to `10` (DEFAULT_LIMIT in nlm-memory)
 *
 * `query` is required as a positional argument here, but the field is
 * optional in the output type because the server treats it as optional.
 * If the caller passes an empty string, the empty string is included in
 * the output (matches the server's `.default("")` behavior).
 *
 * `profile.installScope` is intentionally NOT encoded into the wire input
 * in Phase 2.1. The Phase 2.0 follow-up #1 spec calls for the wrapper to
 * inject the install scope as a filter, but the wire schema has no such
 * field. The filter will be applied by a wrapper MCP server in a later
 * phase; this typed client records the intent on the profile and leaves
 * the wire payload free of scope metadata.
 */
export function buildRecallFactsInput(
  query: string,
  profile: ProfileContext,
  options?: McpRecallOptions
): RecallFactsToolInput {
  const input: RecallFactsToolInput = {
    query,
    mode: options?.mode ?? 'hybrid',
    includeSuperseded: options?.includeSuperseded ?? false,
    minConfidence: options?.minConfidence ?? 0.6,
    limit: options?.limit ?? 10,
  };

  if (options?.subject !== undefined) {
    input.subject = options.subject;
  }
  if (options?.predicate !== undefined) {
    input.predicate = options.predicate;
  }
  if (options?.kind !== undefined) {
    input.kind = options.kind;
  }

  // `profile.profileId` and `profile.installScope` are intentionally not
  // surfaced on the wire here — see the JSDoc above and the file header.
  void profile;

  return input;
}

// ---------- Transport-bound caller ----------

/**
 * Call the nlm-memory `recall_facts` MCP tool over a generic transport.
 *
 * Throws on:
 *   - `isError: true` in the response (with the server's error text).
 *   - The first text content not parsing as a JSON array.
 *
 * Returns the parsed array typed as `FactResult[]`. The cast uses
 * `as unknown as FactResult[]` — we trust the server's schema, not the
 * parsed JSON shape.
 */
export async function recallFacts(
  transport: McpTransport,
  query: string,
  profile: ProfileContext,
  options?: McpRecallOptions
): Promise<FactResult[]> {
  const input = buildRecallFactsInput(query, profile, options);

  const response = await transport.callTool('recall_facts', input);

  if (response.isError === true) {
    const message = response.content[0]?.text ?? 'unknown error';
    throw new Error(`recall_facts MCP call failed: ${message}`);
  }

  const text = response.content[0]?.text;
  if (text === undefined) {
    throw new Error('recall_facts: response had no text content');
  }

  const parsed: unknown = JSON.parse(text);
  if (!Array.isArray(parsed)) {
    throw new Error(
      `recall_facts: expected array, got ${parsed === null ? 'null' : typeof parsed}`
    );
  }

  return parsed as unknown as FactResult[];
}
