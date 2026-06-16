import { describe, expect, it } from 'bun:test';
import type { McpTransport } from './mcp-recall-facts.ts';
import {
  buildRecallSessionsInput,
  recallSessions,
} from './mcp-recall-sessions.ts';

describe('mcp-recall-sessions', () => {
  it('buildRecallSessionsInput produces the canonical nlm-memory shape with defaults', () => {
    const input1 = buildRecallSessionsInput('test query');
    expect(input1.query).toBe('test query');
    expect(input1.mode).toBe('hybrid');
    expect(input1.limit).toBe(10);
    expect(input1.rewrite).toBe(true);
    // Optional fields stay undefined when not provided.
    expect(input1.entity).toBeUndefined();
    expect(input1.kind).toBeUndefined();
  });

  it('buildRecallSessionsInput surfaces custom options when set', () => {
    const input2 = buildRecallSessionsInput('test query', {
      entity: 'test-entity',
      kind: 'decision',
      mode: 'keyword',
      limit: 25,
      rewrite: false,
    });
    expect(input2.query).toBe('test query');
    expect(input2.entity).toBe('test-entity');
    expect(input2.kind).toBe('decision');
    expect(input2.mode).toBe('keyword');
    expect(input2.limit).toBe(25);
    expect(input2.rewrite).toBe(false);
  });

  it('recallSessions parses a {results, total} response', async () => {
    const canned = [
      {
        id: 'sess_1',
        runtime: 'opencode',
        label: 'Test 1',
        summary: 'summary 1',
        started_at: '2026-06-13T00:00:00Z',
        ended_at: null,
        status: 'active',
      },
      {
        id: 'sess_2',
        runtime: 'opencode',
        label: 'Test 2',
        summary: 'summary 2',
        started_at: '2026-06-12T00:00:00Z',
        ended_at: null,
        status: 'closed',
      },
    ];
    const mock: McpTransport = {
      callTool: async (name, input) => {
        expect(name).toBe('recall_sessions');
        expect(input).toBeDefined();
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ results: canned, total: canned.length }),
            },
          ],
        };
      },
    };
    const out = await recallSessions(mock, 'test');
    expect(out.total).toBe(2);
    expect(out.results).toHaveLength(2);
    expect(out.results[0]?.id).toBe('sess_1');
  });

  it('recallSessions parses a bare-array response', async () => {
    const canned = [
      {
        id: 'sess_a',
        runtime: 'opencode',
        label: 'A',
        summary: 'a',
        started_at: '2026-06-13T00:00:00Z',
        ended_at: null,
        status: 'active',
      },
    ];
    const mock: McpTransport = {
      callTool: async () => ({
        content: [{ type: 'text', text: JSON.stringify(canned) }],
      }),
    };
    const out = await recallSessions(mock, 'test');
    expect(out.total).toBe(1);
    expect(out.results).toHaveLength(1);
  });

  it('recallSessions throws on isError: true', async () => {
    const mock: McpTransport = {
      callTool: async () => ({
        isError: true,
        content: [{ type: 'text', text: 'internal error' }],
      }),
    };
    await expect(recallSessions(mock, 'test')).rejects.toThrow(
      /recall_sessions MCP call failed/
    );
  });
});
