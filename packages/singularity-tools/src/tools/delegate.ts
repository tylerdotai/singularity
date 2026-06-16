import { ToolValidationError } from '../errors.js';
import { makeTool, type ToolInstance } from '../registry.js';
import type { ToolContext } from '../types.js';

const TOOL: ToolInstance = makeTool({
  name: 'delegate_task',
  description:
    'Delegate a task to a subagent and return a task ID for tracking',
  riskScore: 'MEDIUM',
  subsystem: ['delegation'],
  inputSchema: {
    type: 'object',
    properties: {
      goal: {
        type: 'string',
        description: 'The goal or objective for the subagent',
      },
      context: {
        type: 'string',
        optional: true,
        description: 'Additional context or background information',
      },
      allowedTools: {
        type: 'array',
        items: { type: 'string' },
        optional: true,
        description: 'List of tool names the subagent may use',
      },
      maxTurns: {
        type: 'number',
        optional: true,
        description: 'Maximum number of turns (default: 10)',
      },
    },
    required: ['goal'],
  },
  async execute(input: unknown, _context: ToolContext) {
    const {
      goal,
      context,
      allowedTools,
      maxTurns = 10,
    } = input as {
      goal: string;
      context?: string;
      allowedTools?: string[];
      maxTurns?: number;
    };

    if (!goal || typeof goal !== 'string') {
      throw new ToolValidationError('goal is required and must be a string');
    }

    if (maxTurns < 1 || maxTurns > 100) {
      throw new ToolValidationError('maxTurns must be between 1 and 100');
    }

    try {
      // Placeholder implementation - delegates to SubagentRunner
      // In production this would create a real subagent task
      const taskId = `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      return {
        result: {
          type: 'json',
          value: {
            taskId,
            status: 'pending',
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
