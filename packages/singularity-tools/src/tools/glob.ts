import { Glob } from 'bun';
import { makeTool, type ToolInstance } from '../registry.js';
import type { ToolContext } from '../types.js';

const TOOL: ToolInstance = makeTool({
  name: 'glob',
  description: 'Find files matching a glob pattern',
  riskScore: 'LOW',
  subsystem: ['file', 'terminal'],
  inputSchema: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: "Glob pattern (e.g. '**/*.ts')" },
      cwd: { type: 'string', optional: true, description: 'Working directory' },
    },
    required: ['pattern'],
  },
  async execute(input: unknown, _context: ToolContext) {
    const { pattern, cwd = '.' } = input as { pattern: string; cwd?: string };
    try {
      const glob = new Glob(pattern);
      const paths: string[] = [];
      for await (const file of glob.scan({ cwd, onlyFiles: true })) {
        paths.push(file);
      }
      return {
        result: { type: 'json', value: { paths, count: paths.length } },
      };
    } catch (err) {
      return { result: { type: 'error', value: String(err) } };
    }
  },
});

export { TOOL };
export default TOOL;
