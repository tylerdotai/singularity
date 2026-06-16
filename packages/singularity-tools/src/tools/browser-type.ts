import { BrowserSelectorNotFoundError } from '../browser/errors.js';
import { BrowserManager } from '../browser/index.js';
import { makeTool, type ToolInstance } from '../registry.js';
import type { ToolContext } from '../types.js';

const TOOL: ToolInstance = makeTool({
  name: 'browser_type',
  description: 'Type text into an element in the browser',
  riskScore: 'MEDIUM',
  approvalRequired: false,
  subsystem: ['browser'],
  inputSchema: {
    type: 'object',
    properties: {
      selector: {
        type: 'string',
        description: 'CSS selector of input element',
      },
      text: { type: 'string', description: 'Text to type' },
    },
    required: ['selector', 'text'],
  },
  async execute(input: unknown, _context: ToolContext) {
    const { selector, text } = input as { selector: string; text: string };
    try {
      await BrowserManager.getInstance().ensureBrowser();
      await BrowserManager.getInstance().fill(selector, text);
      return {
        result: {
          type: 'json',
          value: {
            success: true,
            selector,
            text,
          },
        },
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      const kind =
        err instanceof BrowserSelectorNotFoundError
          ? err.kind
          : 'selector_not_found';
      return {
        result: {
          type: 'json',
          value: {
            success: false,
            error: errorMessage,
            kind,
            selector,
            text,
          },
        },
      };
    }
  },
});

export { TOOL };
export default TOOL;
