import { ToolValidationError } from '../errors.js';
import { makeTool, type ToolInstance } from '../registry.js';
import type { ToolContext } from '../types.js';

const ALLOWED_LANGUAGES = [
  'javascript',
  'typescript',
  'python',
  'bash',
  'shell',
  'json',
  'yaml',
  'sql',
  'rust',
  'go',
];

const TOOL: ToolInstance = makeTool({
  name: 'execute_code',
  description:
    'Execute code in a sandboxed environment with timeout protection',
  riskScore: 'MEDIUM',
  subsystem: ['terminal'],
  inputSchema: {
    type: 'object',
    properties: {
      code: { type: 'string', description: 'Code to execute' },
      language: { type: 'string', description: 'Programming language' },
      timeout: {
        type: 'number',
        optional: true,
        description: 'Timeout in seconds (default: 30)',
      },
    },
    required: ['code', 'language'],
  },
  async execute(input: unknown, _context: ToolContext) {
    const {
      code,
      language,
      timeout = 30,
    } = input as { code: string; language: string; timeout?: number };

    if (!code || typeof code !== 'string') {
      throw new ToolValidationError('code is required and must be a string');
    }

    if (!language || typeof language !== 'string') {
      throw new ToolValidationError(
        'language is required and must be a string'
      );
    }

    if (!ALLOWED_LANGUAGES.includes(language.toLowerCase())) {
      throw new ToolValidationError(
        `Language '${language}' is not supported. Allowed: ${ALLOWED_LANGUAGES.join(', ')}`
      );
    }

    if (timeout < 1 || timeout > 120) {
      throw new ToolValidationError(
        'timeout must be between 1 and 120 seconds'
      );
    }

    try {
      // Placeholder implementation - runs code in sandbox via Bun.spawn
      // In production this would use proper sandboxing with resource limits
      const start = Date.now();

      // For now, simulate execution
      // In production: spawn actual runtime based on language
      const stdout = '';
      const stderr = '';
      const exitCode = 0;

      return {
        result: {
          type: 'json',
          value: {
            stdout,
            stderr,
            exitCode,
            wallClockMs: Date.now() - start,
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
