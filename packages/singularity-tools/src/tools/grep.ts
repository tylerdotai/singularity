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
  name: 'grep',
  description: 'Search for a pattern in files using regex',
  riskScore: 'LOW',
  subsystem: ['file', 'terminal'],
  inputSchema: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Regex pattern to search for' },
      path: {
        type: 'string',
        optional: true,
        description: 'Directory or file to search in',
      },
      context: {
        type: 'number',
        optional: true,
        description: 'Lines of context before/after match',
      },
    },
    required: ['pattern'],
  },
  async execute(input: unknown, _context: ToolContext) {
    const {
      pattern,
      path = '.',
      context = 0,
    } = input as { pattern: string; path?: string; context?: number };
    if (isPathTraversal(path)) {
      return {
        result: { type: 'error', value: `Path traversal blocked: ${path}` },
      };
    }
    try {
      let content: string;
      try {
        content = await Bun.file(path).text();
      } catch {
        return { result: { type: 'error', value: `Could not read: ${path}` } };
      }
      const lines = content.split('\n');
      const matches: Array<{ path: string; line: number; text: string }> = [];
      const re = new RegExp(pattern);
      for (let i = 0; i < lines.length; i++) {
        if (re.test(lines[i])) {
          const from = Math.max(0, i - context);
          const to = Math.min(lines.length, i + context + 1);
          for (let j = from; j < to; j++) {
            matches.push({ path, line: j + 1, text: lines[j] });
          }
        }
      }
      return {
        result: { type: 'json', value: { matches, total: matches.length } },
      };
    } catch (err) {
      return { result: { type: 'error', value: String(err) } };
    }
  },
});

export { TOOL };
export default TOOL;
