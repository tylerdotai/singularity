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

type PatchOp = 'replace' | 'insert' | 'delete';

interface PatchOperation {
  op: PatchOp;
  path: string;
  value?: string;
}

const TOOL: ToolInstance = makeTool({
  name: 'file_patch',
  description: 'Apply JSON patch-style edits to a file',
  riskScore: 'MEDIUM',
  approvalRequired: true,
  subsystem: ['file'],
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Absolute path to file' },
      operations: {
        type: 'array',
        description: 'Patch operations to apply',
        items: {
          type: 'object',
          properties: {
            op: {
              type: 'string',
              enum: ['replace', 'insert', 'delete'],
              description: 'Operation type',
            },
            path: {
              type: 'string',
              description: 'Line number or path for the operation',
            },
            value: {
              type: 'string',
              optional: true,
              description: 'Value for replace/insert operations',
            },
          },
          required: ['op', 'path'],
        },
      },
    },
    required: ['path', 'operations'],
  },
  async execute(input: unknown, _context: ToolContext) {
    const { path, operations } = input as {
      path: string;
      operations: PatchOperation[];
    };
    if (isPathTraversal(path)) {
      return {
        result: { type: 'error', value: `Path traversal blocked: ${path}` },
      };
    }
    try {
      const exists = await Bun.file(path).exists();
      if (!exists) {
        return { result: { type: 'error', value: `File not found: ${path}` } };
      }
      const content = await Bun.file(path).text();
      const lines = content.split('\n');

      for (const op of operations) {
        const lineNum = Number.parseInt(op.path, 10);
        if (Number.isNaN(lineNum)) {
          return {
            result: { type: 'error', value: `Invalid line number: ${op.path}` },
          };
        }
        const idx = lineNum - 1; // 1-indexed

        switch (op.op) {
          case 'replace':
            if (idx < 0 || idx >= lines.length) {
              return {
                result: {
                  type: 'error',
                  value: `Line ${lineNum} out of range`,
                },
              };
            }
            lines[idx] = op.value ?? '';
            break;
          case 'insert':
            if (idx < 0 || idx > lines.length) {
              return {
                result: {
                  type: 'error',
                  value: `Line ${lineNum} out of range`,
                },
              };
            }
            lines.splice(idx, 0, op.value ?? '');
            break;
          case 'delete':
            if (idx < 0 || idx >= lines.length) {
              return {
                result: {
                  type: 'error',
                  value: `Line ${lineNum} out of range`,
                },
              };
            }
            lines.splice(idx, 1);
            break;
          default:
            return {
              result: { type: 'error', value: `Unknown operation: ${op.op}` },
            };
        }
      }

      const patched = lines.join('\n');
      await Bun.write(path, patched);
      return {
        result: {
          type: 'json',
          value: { success: true, patched },
        },
      };
    } catch (err) {
      return { result: { type: 'error', value: String(err) } };
    }
  },
});

export { TOOL };
export default TOOL;
