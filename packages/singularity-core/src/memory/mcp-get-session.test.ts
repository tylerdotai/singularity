import { describe, expect, it } from 'bun:test';
import { getSession } from './mcp-get-session.ts';
import type { McpTransport } from './mcp-recall-facts.ts';

describe('mcp-get-session', () => {
  it('getSession returns the full session with lineage', async () => {
    const canned = {
      id: 'sess_1',
      runtime: 'opencode',
      runtime_session_id: null,
      started_at: '2026-06-13T00:00:00Z',
      ended_at: null,
      duration_min: null,
      label: 'Test session',
      summary: 'Test summary',
      body: 'long transcript body...',
      status: 'superseded',
      transcript_kind: null,
      transcript_path: null,
      transcript_offset: null,
      transcript_length: null,
      created_at: '2026-06-13T00:00:00Z',
      updated_at: '2026-06-13T01:00:00Z',
      supersedes: [{ id: 'sess_old', label: 'Old', summary: 'old summary' }],
      supersededBy: {
        id: 'sess_new',
        label: 'New',
        summary: 'new summary',
        reason: 'outdated',
        recordedBy: 'mcp',
      },
    };
    const mock: McpTransport = {
      callTool: async (name, input) => {
        expect(name).toBe('get_session');
        expect(input).toEqual({ id: 'sess_1' });
        return {
          content: [{ type: 'text', text: JSON.stringify(canned) }],
        };
      },
    };
    const got = await getSession(mock, 'sess_1');
    expect(got.id).toBe('sess_1');
    expect(got.label).toBe('Test session');
    expect(got.supersedes).toHaveLength(1);
    expect(got.supersedes[0]?.id).toBe('sess_old');
    expect(got.supersededBy?.id).toBe('sess_new');
    expect(got.supersededBy?.reason).toBe('outdated');
  });

  it('getSession throws on isError: true', async () => {
    const mock: McpTransport = {
      callTool: async () => ({
        isError: true,
        content: [{ type: 'text', text: 'session not found' }],
      }),
    };
    await expect(getSession(mock, 'sess_1')).rejects.toThrow(
      /get_session MCP call failed/
    );
  });

  it('getSession throws on empty id (fail-fast before transport)', async () => {
    const mock: McpTransport = {
      callTool: async () => ({ content: [{ type: 'text', text: '{}' }] }),
    };
    await expect(getSession(mock, '')).rejects.toThrow(/id is required/);
  });
});
