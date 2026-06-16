import { BrowserUploadError } from '../browser/errors.js';
import { BrowserManager } from '../browser/index.js';
import { makeTool, type ToolInstance } from '../registry.js';
import type { ToolContext } from '../types.js';

const TOOL: ToolInstance = makeTool({
  name: 'browser_upload',
  description: 'Upload a file to a file input element in the browser',
  riskScore: 'MEDIUM',
  approvalRequired: false,
  subsystem: ['browser'],
  inputSchema: {
    type: 'object',
    properties: {
      selector: {
        type: 'string',
        description: 'CSS selector of file input element',
      },
      filePath: { type: 'string', description: 'Path to file to upload' },
    },
    required: ['selector', 'filePath'],
  },
  async execute(input: unknown, _context: ToolContext) {
    const { selector, filePath } = input as {
      selector: string;
      filePath: string;
    };
    try {
      await BrowserManager.getInstance().ensureBrowser();
      await BrowserManager.getInstance().setInputFiles(selector, filePath);
      return {
        result: {
          type: 'json',
          value: {
            success: true,
            selector,
            filePath,
          },
        },
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      const kind =
        err instanceof BrowserUploadError ? err.kind : 'upload_failed';
      return {
        result: {
          type: 'json',
          value: {
            success: false,
            error: errorMessage,
            kind,
            selector,
            filePath,
          },
        },
      };
    }
  },
});

export { TOOL };
export default TOOL;
