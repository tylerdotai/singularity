import { BrowserSelectorNotFoundError } from '../browser/errors.js';
import { BrowserManager } from '../browser/index.js';
import { makeTool, type ToolInstance } from '../registry.js';
import type { ToolContext } from '../types.js';

const TOOL: ToolInstance = makeTool({
  name: 'browser_click',
  description: 'Click an element in the browser by selector',
  riskScore: 'MEDIUM',
  approvalRequired: false,
  subsystem: ['browser'],
  inputSchema: {
    type: 'object',
    properties: {
      selector: {
        type: 'string',
        description: 'CSS selector of element to click',
      },
    },
    required: ['selector'],
  },
  async execute(input: unknown, _context: ToolContext) {
    const { selector } = input as { selector: string };
    try {
      await BrowserManager.getInstance().ensureBrowser();
      await BrowserManager.getInstance().click(selector);
      return {
        result: {
          type: 'json',
          value: {
            success: true,
            selector,
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
          },
        },
      };
    }
  },
});

export { TOOL };
export default TOOL;
