import { makeTool, type ToolInstance } from '../registry.js';
import type { ToolContext } from '../types.js';

/**
 * Search sessions via full-text search in SessionStore.
 * Input: { query: string, limit?: number }
 * Output: { sessions: Array<{id, title, createdAt}> }
 */
const TOOL: ToolInstance = makeTool({
  name: 'session_search',
  description: 'Search sessions via full-text search',
  riskScore: 'LOW',
  approvalRequired: false,
  subsystem: ['memory'],
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query string' },
      limit: {
        type: 'number',
        optional: true,
        description: 'Maximum number of results (default: 20)',
      },
    },
    required: ['query'],
  },
  async execute(input: unknown, _context: ToolContext) {
    const { query, limit = 20 } = input as { query: string; limit?: number };

    // TODO: Implement actual FTS search via SessionStore
    // This is a skeleton implementation for Phase 13 (Tool Parity)
    const sessions = [
      {
        id: 'sess_stub_placeholder',
        title: `Search results for: ${query}`,
        createdAt: new Date().toISOString(),
      },
    ];

    return {
      result: { type: 'json', value: { sessions: sessions.slice(0, limit) } },
    };
  },
});

export { TOOL };
export default TOOL;
