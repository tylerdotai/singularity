import {
  BrowserEvaluationError,
  BrowserNavigationError,
  BrowserSelectorNotFoundError,
} from '../browser/errors.js';
import { BrowserManager } from '../browser/index.js';
import { makeTool, type ToolInstance } from '../registry.js';
import type { ToolContext } from '../types.js';

type ComputerUseAction =
  | 'click'
  | 'type'
  | 'screenshot'
  | 'navigate'
  | 'keypress';

const TOOL: ToolInstance = makeTool({
  name: 'computer_use',
  description:
    'OS-level computer control: click, type, screenshot, navigate, keypress. Uses Playwright as the underlying engine.',
  riskScore: 'CRITICAL',
  approvalRequired: true,
  subsystem: ['browser', 'automation'],
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['click', 'type', 'screenshot', 'navigate', 'keypress'],
        description:
          'Action to perform: click (element by selector), type (text into element), screenshot (page or element), navigate (to URL), keypress (keyboard key)',
      },
      target: {
        type: 'string',
        description:
          'CSS selector for click/type actions, URL for navigate action, or key name for keypress action',
      },
      value: {
        type: 'string',
        description: 'Text to type (for type action)',
        optional: true,
      },
    },
    required: ['action'],
  },
  async execute(input: unknown, _context: ToolContext) {
    const { action, target, value } = input as {
      action: ComputerUseAction;
      target?: string;
      value?: string;
    };

    try {
      await BrowserManager.getInstance().ensureBrowser();
      const manager = BrowserManager.getInstance();

      switch (action) {
        case 'navigate': {
          if (!target) {
            return {
              result: {
                type: 'json',
                value: {
                  success: false,
                  error: 'target is required for navigate action',
                  action,
                  target: null,
                  value: null,
                },
              },
            };
          }
          const navResult = await manager.navigate(target);
          return {
            result: {
              type: 'json',
              value: {
                success: true,
                action,
                target: navResult.url,
                value: null,
              },
            },
          };
        }

        case 'click':
          if (!target) {
            return {
              result: {
                type: 'json',
                value: {
                  success: false,
                  error: 'target (selector) is required for click action',
                  action,
                  target: null,
                  value: null,
                },
              },
            };
          }
          await manager.click(target);
          return {
            result: {
              type: 'json',
              value: {
                success: true,
                action,
                target,
                value: null,
              },
            },
          };

        case 'type':
          if (!target || !value) {
            return {
              result: {
                type: 'json',
                value: {
                  success: false,
                  error:
                    'target (selector) and value (text) are required for type action',
                  action,
                  target: target ?? null,
                  value: null,
                },
              },
            };
          }
          await manager.fill(target, value);
          return {
            result: {
              type: 'json',
              value: {
                success: true,
                action,
                target,
                value,
              },
            },
          };

        case 'screenshot': {
          const screenshotResult = await manager.screenshot(
            target ?? undefined
          );
          return {
            result: {
              type: 'json',
              value: {
                success: true,
                action,
                target: target ?? null,
                value: null,
                dataUrl: screenshotResult.dataUrl,
              },
            },
          };
        }

        case 'keypress':
          if (!target) {
            return {
              result: {
                type: 'json',
                value: {
                  success: false,
                  error: 'target (key name) is required for keypress action',
                  action,
                  target: null,
                  value: null,
                },
              },
            };
          }
          await manager.keypress(target);
          return {
            result: {
              type: 'json',
              value: {
                success: true,
                action,
                target,
                value: null,
              },
            },
          };

        default:
          return {
            result: {
              type: 'json',
              value: {
                success: false,
                error: `Unknown action: ${action}`,
                action,
                target: target ?? null,
                value: value ?? null,
              },
            },
          };
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      let kind: string;
      if (err instanceof BrowserNavigationError) {
        kind = err.kind;
      } else if (err instanceof BrowserSelectorNotFoundError) {
        kind = err.kind;
      } else if (err instanceof BrowserEvaluationError) {
        kind = err.kind;
      } else {
        kind = 'evaluation_error';
      }
      return {
        result: {
          type: 'json',
          value: {
            success: false,
            error: errorMessage,
            kind,
            action,
            target: target ?? null,
            value: value ?? null,
          },
        },
      };
    }
  },
});

export { TOOL };
export default TOOL;
