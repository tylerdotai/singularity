import { BrowserNavigationError } from '../browser/errors.js';
import { BrowserManager } from '../browser/index.js';
import { makeTool, type ToolInstance } from '../registry.js';
import type { ToolContext } from '../types.js';

const TOOL: ToolInstance = makeTool({
  name: 'browser_navigate',
  description: 'Navigate to a URL in the browser',
  riskScore: 'MEDIUM',
  approvalRequired: false,
  subsystem: ['browser'],
  inputSchema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'URL to navigate to' },
    },
    required: ['url'],
  },
  async execute(input: unknown, _context: ToolContext) {
    const { url } = input as { url: string };
    try {
      await BrowserManager.getInstance().ensureBrowser();
      const result = await BrowserManager.getInstance().navigate(url);
      return {
        result: {
          type: 'json',
          value: {
            success: true,
            url: result.url,
            title: result.title,
          },
        },
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      const kind =
        err instanceof BrowserNavigationError ? err.kind : 'navigation_failed';
      return {
        result: {
          type: 'json',
          value: {
            success: false,
            error: errorMessage,
            kind,
            url,
          },
        },
      };
    }
  },
});

export { TOOL };
export default TOOL;
