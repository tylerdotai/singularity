import { describe, expect, it } from 'bun:test';
import {
  buildRecallFactsInput,
  type FactResult,
  type McpTransport,
  recallFacts,
} from './mcp-recall-facts.ts';

describe('mcp-recall-facts', () => {
  it('buildRecallFactsInput produces the canonical nlm-memory shape', () => {
    // Defaults match nlm-memory's MCP server defaults
    // (src/mcp/server.ts:557-592).
    const input1 = buildRecallFactsInput('test query', { profileId: 'p1' });
    expect(input1.query).toBe('test query');
    expect(input1.mode).toBe('hybrid');
    expect(input1.includeSuperseded).toBe(false);
    expect(input1.minConfidence).toBe(0.6);
    expect(input1.limit).toBe(10);
    // Optional fields stay undefined when not provided.
    expect(input1.subject).toBeUndefined();
    expect(input1.predicate).toBeUndefined();
    expect(input1.kind).toBeUndefined();

    // Custom options override every default.
    const input2 = buildRecallFactsInput(
      'test query',
      { profileId: 'p2', installScope: 'scope-abc' },
      {
        subject: 'test-subject',
        predicate: 'framework',
        kind: 'decision',
        mode: 'keyword',
        includeSuperseded: true,
        minConfidence: 0.8,
        limit: 25,
      }
    );
    expect(input2.query).toBe('test query');
    expect(input2.subject).toBe('test-subject');
    expect(input2.predicate).toBe('framework');
    expect(input2.kind).toBe('decision');
    expect(input2.mode).toBe('keyword');
    expect(input2.includeSuperseded).toBe(true);
    expect(input2.minConfidence).toBe(0.8);
    expect(input2.limit).toBe(25);
    // installScope is recorded on profile but not on the wire format
    // (Phase 2.1 leaves the filter to a later wrapping phase).
  });

  it('buildRecallFactsInput preserves an explicit empty query', () => {
    // nlm-memory's server treats `query: ""` as a valid default; we mirror
    // that by including the field verbatim when the caller passes "".
    const input = buildRecallFactsInput('', { profileId: 'p-empty' });
    expect(input.query).toBe('');
    expect(input.mode).toBe('hybrid');
  });

  it('recallFacts parses a mock transport response', async () => {
    const canned: FactResult[] = [
      {
        id: 'fact_abc',
        kind: 'decision',
        subject: 'test-subject',
        predicate: 'framework',
        value: 'Hono',
        confidence: 0.9,
        source_session_id: 'sess_1',
        source_quote: 'We chose Hono',
        created_at: '2026-06-13T00:00:00Z',
        corroborationCount: 3,
      },
      {
        id: 'fact_def',
        kind: 'attribute',
        subject: 'test-subject',
        predicate: 'port',
        value: '3000',
        confidence: 0.7,
        source_session_id: 'sess_2',
        source_quote: null,
        created_at: '2026-06-12T00:00:00Z',
      },
    ];
    const mockTransport: McpTransport = {
      callTool: async (name, input) => {
        expect(name).toBe('recall_facts');
        expect(input).toBeDefined();
        return { content: [{ type: 'text', text: JSON.stringify(canned) }] };
      },
    };
    const results = await recallFacts(mockTransport, 'framework', {
      profileId: 'p1',
    });
    expect(results).toHaveLength(2);
    expect(results[0]?.id).toBe('fact_abc');
    expect(results[0]?.value).toBe('Hono');
    expect(results[0]?.corroborationCount).toBe(3);
    expect(results[1]?.id).toBe('fact_def');
    expect(results[1]?.source_quote).toBeNull();
  });

  it('recallFacts throws on isError: true', async () => {
    const mockTransport: McpTransport = {
      callTool: async () => ({
        isError: true,
        content: [{ type: 'text', text: 'internal server error' }],
      }),
    };
    await expect(
      recallFacts(mockTransport, 'framework', { profileId: 'p1' })
    ).rejects.toThrow(/recall_facts MCP call failed.*internal server error/);
  });

  it('recallFacts throws when response is not an array', async () => {
    const mockTransport: McpTransport = {
      callTool: async () => ({
        content: [
          { type: 'text', text: JSON.stringify({ error: 'not an array' }) },
        ],
      }),
    };
    await expect(
      recallFacts(mockTransport, 'framework', { profileId: 'p1' })
    ).rejects.toThrow(/expected array/);
  });
});
