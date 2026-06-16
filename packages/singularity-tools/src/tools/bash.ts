import { makeTool, type ToolInstance } from '../registry.js';
import type { ToolContext } from '../types.js';

/**
 * Sanitize shell input using an allowlist of safe characters.
 * Rejects: semicolons, pipes, subshells, redirects, glob chars, quotes, etc.
 * Allows: alphanumeric, dash, underscore, dot, space, slash, plus limited special chars
 */
function sanitizeShellInput(
  command: string
): { valid: true } | { valid: false; reason: string } {
  // Block dangerous patterns first
  if (command.includes(';'))
    return { valid: false, reason: 'Semicolons are not allowed' };
  if (command.includes('|'))
    return { valid: false, reason: 'Pipes are not allowed' };
  if (command.includes('&&'))
    return { valid: false, reason: 'Double-ampersand is not allowed' };
  if (command.includes('||'))
    return { valid: false, reason: 'Double-pipe is not allowed' };
  if (command.includes('`'))
    return { valid: false, reason: 'Backticks are not allowed' };
  if (command.includes('${'))
    return { valid: false, reason: 'Shell substitution is not allowed' };
  if (command.includes('}'))
    return { valid: false, reason: 'Shell substitution is not allowed' };
  if (command.includes('$('))
    return { valid: false, reason: 'Command substitution is not allowed' };
  if (command.includes('<'))
    return { valid: false, reason: 'Redirects are not allowed' };
  if (command.includes('>'))
    return { valid: false, reason: 'Redirects are not allowed' };
  if (command.includes('{'))
    return { valid: false, reason: 'Brace expansion is not allowed' };
  if (command.includes('}'))
    return { valid: false, reason: 'Brace expansion is not allowed' };
  if (command.includes('['))
    return { valid: false, reason: 'Glob brackets are not allowed' };
  if (command.includes(']'))
    return { valid: false, reason: 'Glob brackets are not allowed' };
  if (command.includes('\n'))
    return { valid: false, reason: 'Newlines are not allowed' };
  if (command.includes("'"))
    return { valid: false, reason: 'Single quotes are not allowed' };
  if (command.includes('"'))
    return { valid: false, reason: 'Double quotes are not allowed' };
  if (command.includes('*'))
    return { valid: false, reason: 'Glob wildcard is not allowed' };
  if (command.includes('?'))
    return { valid: false, reason: 'Glob wildcard is not allowed' };
  if (command.includes('\\'))
    return { valid: false, reason: 'Backslash is not allowed' };
  if (command.includes('~'))
    return { valid: false, reason: 'Tilde expansion is not allowed' };

  // Path traversal check
  const normalized = command.replace(/\\/g, '/');
  const parts = normalized.split('/');
  let depth = 0;
  for (const part of parts) {
    if (part === '..') depth--;
    else if (part !== '' && part !== '.') depth++;
    if (depth < 0)
      return { valid: false, reason: 'Path traversal is not allowed' };
  }

  // Allowlist: alphanumeric, dash, underscore, dot, space, slash, colon, equals, plus, comma, at, percent
  if (!/^[a-zA-Z0-9_\-./:=,@%+ ]+$/.test(command)) {
    return { valid: false, reason: 'Command contains disallowed characters' };
  }

  return { valid: true };
}

const TOOL: ToolInstance = makeTool({
  name: 'bash',
  description: 'Execute a shell command',
  riskScore: 'HIGH',
  approvalRequired: true,
  subsystem: ['file', 'terminal'],
  inputSchema: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'Shell command to execute' },
      workdir: {
        type: 'string',
        optional: true,
        description: 'Working directory',
      },
      timeout: {
        type: 'number',
        optional: true,
        description: 'Timeout in ms (default: 30000)',
      },
    },
    required: ['command'],
  },
  async execute(input: unknown, _context: ToolContext) {
    const {
      command,
      workdir,
      timeout = 30000,
    } = input as { command: string; workdir?: string; timeout?: number };
    const sanitized = sanitizeShellInput(command);
    if (!sanitized.valid) {
      return {
        result: {
          type: 'error',
          value: `Command rejected: ${sanitized.reason}`,
        },
      };
    }
    const start = Date.now();
    try {
      const proc = Bun.spawn(['/bin/sh', '-c', command], {
        cwd: workdir,
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const timeoutPromise = new Promise<'timed_out'>((resolve) =>
        setTimeout(() => resolve('timed_out'), timeout)
      );
      const exitResult = await Promise.race([
        proc.exited.then((c) => ({ code: c }) as const),
        timeoutPromise.then(() => 'timed_out' as const),
      ]);
      if (exitResult === 'timed_out') {
        proc.kill();
        return {
          result: {
            type: 'json',
            value: {
              command,
              cwd: workdir ?? '.',
              exitCode: -1,
              output: '',
              truncated: false,
              wallClockMs: timeout,
              timeout: true,
            },
          },
        };
      }
      const code = exitResult.code;
      const rawOut = await new Response(proc.stdout).text();
      const rawErr = await new Response(proc.stderr).text();
      const output = rawOut + (rawErr ? (rawOut ? '\n' : '') + rawErr : '');
      const wallClockMs = Date.now() - start;
      const truncated = output.length > 1_000_000;
      return {
        result: {
          type: 'json',
          value: {
            command,
            cwd: workdir ?? '.',
            exitCode: code,
            output: truncated ? output.slice(0, 1_000_000) : output,
            truncated,
            wallClockMs,
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
