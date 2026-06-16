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

function applyPatch(
  content: string,
  patch: string
): { result: string; linesChanged: number } {
  const lines = content.split('\n');
  const patchLines = patch.split('\n');
  const hunks: { start: number; oldLines: string[]; newLines: string[] }[] = [];
  let i = 0;
  while (i < patchLines.length) {
    const m = patchLines[i].match(
      /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/
    );
    if (!m) {
      i++;
      continue;
    }
    const oldStart = Number.parseInt(m[1]) - 1;
    const oldCount = Number.parseInt(m[2] ?? '1');
    const newStart = Number.parseInt(m[3]) - 1;
    const newCount = Number.parseInt(m[4] ?? '1');
    i++;
    const oldLines: string[] = [];
    const newLines: string[] = [];
    while (i < patchLines.length && !patchLines[i].match(/^@@/)) {
      const l = patchLines[i];
      if (l.startsWith('-') || l.startsWith(' ') || l.length === 0) {
        if (l.startsWith('-')) oldLines.push(l.slice(1));
        else if (l.startsWith(' ') || l.length === 0) {
          oldLines.push(l.slice(1) || '');
          newLines.push(l.slice(1) || '');
        }
      } else if (l.startsWith('+')) {
        newLines.push(l.slice(1));
      }
      i++;
    }
    hunks.push({ start: oldStart, oldLines, newLines });
  }
  let offset = 0;
  let linesChanged = 0;
  for (const h of hunks) {
    const pos = h.start + offset;
    const delCount = h.oldLines.length;
    const addCount = h.newLines.length;
    lines.splice(pos, delCount, ...h.newLines);
    offset += addCount - delCount;
    linesChanged += delCount + addCount;
  }
  return { result: lines.join('\n'), linesChanged };
}

const TOOL: ToolInstance = makeTool({
  name: 'edit',
  description: 'Apply a unified diff patch to a file',
  riskScore: 'MEDIUM',
  approvalRequired: true,
  subsystem: ['file', 'terminal'],
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Absolute file path' },
      patch: { type: 'string', description: 'Unified diff patch' },
      create: {
        type: 'boolean',
        optional: true,
        description: "Create file if it doesn't exist",
      },
    },
    required: ['path', 'patch'],
  },
  async execute(input: unknown, _context: ToolContext) {
    const {
      path,
      patch,
      create = false,
    } = input as { path: string; patch: string; create?: boolean };
    if (isPathTraversal(path)) {
      return {
        result: { type: 'error', value: `Path traversal blocked: ${path}` },
      };
    }
    try {
      const exists = await Bun.file(path).exists();
      if (!exists) {
        if (!create)
          return {
            result: { type: 'error', value: `File not found: ${path}` },
          };
        await Bun.write(path, '');
      }
      const content = await Bun.file(path).text();
      const { result: newContent, linesChanged } = applyPatch(content, patch);
      await Bun.write(path, newContent);
      return {
        result: { type: 'json', value: { path, linesChanged, newContent } },
      };
    } catch (err) {
      return { result: { type: 'error', value: String(err) } };
    }
  },
});

export { TOOL };
export default TOOL;
