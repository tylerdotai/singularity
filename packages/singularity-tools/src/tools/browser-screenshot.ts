import { BrowserError } from '../browser/errors.js';
import { BrowserManager } from '../browser/index.js';
import { makeTool, type ToolInstance } from '../registry.js';
import type { ToolContext } from '../types.js';

const TOOL: ToolInstance = makeTool({
  name: 'browser_screenshot',
  description: 'Take a screenshot of the browser page or element',
  riskScore: 'LOW',
  approvalRequired: false,
  subsystem: ['browser'],
  inputSchema: {
    type: 'object',
    properties: {
      selector: {
        type: 'string',
        description: 'Optional CSS selector to screenshot specific element',
        optional: true,
      },
    },
  },
  async execute(input: unknown, _context: ToolContext) {
    const { selector } = input as { selector?: string };
    try {
      await BrowserManager.getInstance().ensureBrowser();
      const result = await BrowserManager.getInstance().screenshot(selector);
      return {
        result: {
          type: 'json',
          value: {
            success: true,
            selector: result.selector,
            dataUrl: result.dataUrl,
          },
        },
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      const kind = err instanceof BrowserError ? err.kind : 'navigation_failed';
      return {
        result: {
          type: 'json',
          value: {
            success: false,
            error: errorMessage,
            kind,
            selector: selector ?? null,
            dataUrl: '',
          },
        },
      };
    }
  },
});

export { TOOL };
export default TOOL;
