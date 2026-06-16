import { makeTool, type ToolInstance } from '../registry.js';
import type { ToolContext } from '../types.js';

const TOOL: ToolInstance = makeTool({
  name: 'webfetch',
  description: 'Fetch a URL via HTTP',
  riskScore: 'HIGH',
  subsystem: ['file', 'terminal'],
  inputSchema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'URL to fetch' },
      method: {
        type: 'string',
        optional: true,
        description: 'HTTP method (default: GET)',
      },
      body: { type: 'string', optional: true, description: 'Request body' },
    },
    required: ['url'],
  },
  async execute(input: unknown, _context: ToolContext) {
    const {
      url,
      method = 'GET',
      body,
    } = input as { url: string; method?: string; body?: string };
    try {
      const response = await fetch(url, { method, body, redirect: 'follow' });
      const text = await response.text();
      const truncated = text.length > 1_000_000;
      const headers: Record<string, string> = {};
      response.headers.forEach((v, k) => {
        headers[k] = v;
      });
      return {
        result: {
          type: 'json',
          value: {
            status: response.status,
            headers,
            body: truncated ? text.slice(0, 1_000_000) : text,
            truncated,
          },
        },
      };
    } catch (err) {
      return { result: { type: 'error', value: String(err) } };
    }
  },
});

export { TOOL };
export default TOOL;
