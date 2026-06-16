import { makeTool, type ToolInstance } from '../registry.js';
import type { ToolContext } from '../types.js';

/**
 * Manage todos with create/list/complete/delete actions.
 * Input: { action: 'create' | 'list' | 'complete' | 'delete', text?: string, id?: string }
 * Output: { todos: Array<{id, text, status, createdAt}> }
 */
const TOOL: ToolInstance = makeTool({
  name: 'todo',
  description: 'Manage todos with create, list, complete, and delete actions',
  riskScore: 'LOW',
  approvalRequired: false,
  subsystem: ['memory'],
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['create', 'list', 'complete', 'delete'],
        description: 'Action to perform',
      },
      text: {
        type: 'string',
        optional: true,
        description: 'Todo text (required for create)',
      },
      id: {
        type: 'string',
        optional: true,
        description: 'Todo ID (required for complete/delete)',
      },
    },
    required: ['action'],
  },
  async execute(input: unknown, _context: ToolContext) {
    const { action, text, id } = input as {
      action: 'create' | 'list' | 'complete' | 'delete';
      text?: string;
      id?: string;
    };

    // TODO: Implement actual todo storage via SessionStore
    // This is a skeleton implementation for Phase 13 (Tool Parity)
    const todos = [
      {
        id: 'todo_stub_placeholder',
        text: 'Placeholder todo',
        status: 'pending',
        createdAt: new Date().toISOString(),
      },
    ];

    if (action === 'list') {
      return { result: { type: 'json', value: { todos } } };
    }

    if (action === 'create') {
      if (!text) {
        return {
          result: {
            type: 'error',
            value: 'text is required for create action',
          },
        };
      }
      return {
        result: {
          type: 'json',
          value: {
            todos: [
              {
                id: `todo_${Date.now()}`,
                text,
                status: 'pending',
                createdAt: new Date().toISOString(),
              },
            ],
          },
        },
      };
    }

    if (action === 'complete' || action === 'delete') {
      if (!id) {
        return {
          result: {
            type: 'error',
            value: `id is required for ${action} action`,
          },
        };
      }
      return { result: { type: 'json', value: { todos: [] } } };
    }

    return { result: { type: 'error', value: `Unknown action: ${action}` } };
  },
});

export { TOOL };
export default TOOL;
