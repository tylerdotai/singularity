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
  name: 'file_write',
  description: 'Write content to a file',
  riskScore: 'MEDIUM',
  approvalRequired: true,
  subsystem: ['file'],
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Absolute path to file' },
      content: { type: 'string', description: 'Content to write' },
      append: {
        type: 'boolean',
        optional: true,
        description: 'Append to file instead of overwriting',
      },
    },
    required: ['path', 'content'],
  },
  async execute(input: unknown, _context: ToolContext) {
    const {
      path,
      content,
      append = false,
    } = input as { path: string; content: string; append?: boolean };
    if (isPathTraversal(path)) {
      return {
        result: { type: 'error', value: `Path traversal blocked: ${path}` },
      };
    }
    try {
      if (append) {
        const existing = (await Bun.file(path).exists())
          ? await Bun.file(path).text()
          : '';
        await Bun.write(path, existing + content);
      } else {
        await Bun.write(path, content);
      }
      return {
        result: {
          type: 'json',
          value: { bytesWritten: new TextEncoder().encode(content).byteLength },
        },
      };
    } catch (err) {
      return { result: { type: 'error', value: String(err) } };
    }
  },
});

export { TOOL };
export default TOOL;
