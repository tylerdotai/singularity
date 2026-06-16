import { makeTool, type ToolInstance } from '../registry.js';
import type { ToolContext } from '../types.js';

function isPathTraversal(path: string): boolean {
  const normalized = path.replace(/\\/g, '/');
  const parts = normalized.split('/');
  let depth = 0;
  for (const part of parts) {
    if (part === '..') depth--;
    else if (part !== '' && part !== '.') depth++;
    if (depth < 0) return true;
  }
  return false;
}

const TOOL: ToolInstance = makeTool({
  name: 'read',
  description: 'Read a file',
  riskScore: 'LOW',
  subsystem: ['file', 'terminal'],
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Absolute path to file' },
      start: {
        type: 'number',
        optional: true,
        description: 'Line to start from (1-indexed)',
      },
      limit: {
        type: 'number',
        optional: true,
        description: 'Max lines to read',
      },
    },
    required: ['path'],
  },
  async execute(input: unknown, _context: ToolContext) {
    const { path, start, limit } = input as {
      path: string;
      start?: number;
      limit?: number;
    };
    if (isPathTraversal(path)) {
      return {
        result: { type: 'error', value: `Path traversal blocked: ${path}` },
      };
    }
    try {
      if (!(await Bun.file(path).exists())) {
        return { result: { type: 'error', value: `File not found: ${path}` } };
      }
      const content = await Bun.file(path).text();
      const lines = content.split('\n');
      const from = Math.max(0, (start ?? 1) - 1);
      const to = limit ? from + limit : lines.length;
      const sliced = lines.slice(from, to);
      const selectedContent = sliced.join('\n');
      return {
        result: {
          type: 'json',
          value: {
            path,
            content: selectedContent,
            lineCount: lines.length,
            charCount: content.length,
            truncated: content.length > 1_000_000,
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
