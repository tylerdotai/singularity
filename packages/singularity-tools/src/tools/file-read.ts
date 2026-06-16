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
  name: 'file_read',
  description: 'Read a file from the filesystem',
  riskScore: 'LOW',
  subsystem: ['file'],
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Absolute path to file' },
      offset: {
        type: 'number',
        optional: true,
        description: 'Byte offset to start reading from',
      },
      limit: {
        type: 'number',
        optional: true,
        description: 'Maximum bytes to read',
      },
    },
    required: ['path'],
  },
  async execute(input: unknown, _context: ToolContext) {
    const { path, offset, limit } = input as {
      path: string;
      offset?: number;
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
      const start = offset ?? 0;
      const end = limit ? start + limit : content.length;
      const sliced = content.slice(start, end);
      return {
        result: {
          type: 'json',
          value: { content: sliced, size: sliced.length },
        },
      };
    } catch (err) {
      return { result: { type: 'error', value: String(err) } };
    }
  },
});

export { TOOL };
export default TOOL;
