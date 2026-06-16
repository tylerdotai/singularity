import { BrowserEvaluationError } from '../browser/errors.js';
import { BrowserManager } from '../browser/index.js';
import { makeTool, type ToolInstance } from '../registry.js';
import type { ToolContext } from '../types.js';

const TOOL: ToolInstance = makeTool({
  name: 'browser_evaluate',
  description: 'Execute JavaScript in the browser context',
  riskScore: 'MEDIUM',
  approvalRequired: false,
  subsystem: ['browser'],
  inputSchema: {
    type: 'object',
    properties: {
      script: { type: 'string', description: 'JavaScript code to execute' },
    },
    required: ['script'],
  },
  async execute(input: unknown, _context: ToolContext) {
    const { script } = input as { script: string };
    try {
      await BrowserManager.getInstance().ensureBrowser();
      const result = await BrowserManager.getInstance().evaluate(script);
      return {
        result: {
          type: 'json',
          value: {
            success: true,
            script,
            result: result.result,
            console: result.console,
          },
        },
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      const kind =
        err instanceof BrowserEvaluationError ? err.kind : 'evaluation_error';
      return {
        result: {
          type: 'json',
          value: {
            success: false,
            error: errorMessage,
            kind,
            script,
            result: null,
            console: [],
          },
        },
      };
    }
  },
});

export { TOOL };
export default TOOL;
