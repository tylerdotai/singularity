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
  name: 'applypatch',
  description: 'Apply multiple unified diff patches in one call',
  riskScore: 'MEDIUM',
  subsystem: ['file', 'terminal'],
  inputSchema: {
    type: 'object',
    properties: {
      patches: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            patch: { type: 'string' },
            create: { type: 'boolean', optional: true },
          },
          required: ['path', 'patch'],
        },
      },
    },
    required: ['patches'],
  },
  async execute(input: unknown, _context: ToolContext) {
    const { patches } = input as {
      patches: Array<{ path: string; patch: string; create?: boolean }>;
    };
    const applied: string[] = [];
    const failed: Array<{ path: string; error: string }> = [];
    for (const { path, patch, create = false } of patches) {
      if (isPathTraversal(path)) {
        failed.push({ path, error: 'Path traversal blocked' });
        continue;
      }
      try {
        const exists = await Bun.file(path).exists();
        if (!exists) {
          if (!create) {
            failed.push({ path, error: 'File not found' });
            continue;
          }
          await Bun.write(path, '');
        }
        const content = await Bun.file(path).text();
        const result = applyPatchSimple(content, patch);
        await Bun.write(path, result);
        applied.push(path);
      } catch (err) {
        failed.push({ path, error: String(err) });
      }
    }
    return {
      result: { type: 'json', value: { applied: applied.length, failed } },
    };
  },
});

function applyPatchSimple(content: string, patch: string): string {
  const lines = content.split('\n');
  const patchLines = patch.split('\n');
  let offset = 0;
  let patchIdx = 0;
  while (patchIdx < patchLines.length) {
    const m = patchLines[patchIdx].match(/^@@ -(\d+)(?:,(\d+))? \+/);
    if (m) {
      offset = 0;
      patchIdx++;
      continue;
    }
    const l = patchLines[patchIdx];
    if (l.startsWith('-')) {
      const delIdx = patchIdx + offset;
      if (delIdx >= 0 && delIdx < lines.length) {
        lines.splice(delIdx, 1);
        offset--;
      }
    } else if (l.startsWith('+')) {
      const addIdx = patchIdx + offset;
      lines.splice(addIdx, 0, l.slice(1));
      offset++;
    }
    patchIdx++;
  }
  return lines.join('\n');
}

export { TOOL };
export default TOOL;
