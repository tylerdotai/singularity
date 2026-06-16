import { makeTool, type ToolInstance } from '../registry.js';
import type { ToolContext } from '../types.js';

/**
 * Send a message via Telegram or Discord platform.
 * Input: { platform: 'telegram' | 'discord', chatId: string, text: string }
 * Output: { messageId: string, status: 'sent' }
 * Risk: HIGH — requires approvalRequired: true
 */
const TOOL: ToolInstance = makeTool({
  name: 'send_message',
  description: 'Send a message via Telegram or Discord',
  riskScore: 'HIGH',
  approvalRequired: true,
  subsystem: ['platform'],
  inputSchema: {
    type: 'object',
    properties: {
      platform: {
        type: 'string',
        enum: ['telegram', 'discord'],
        description: 'Messaging platform',
      },
      chatId: { type: 'string', description: 'Chat ID or channel identifier' },
      text: { type: 'string', description: 'Message text to send' },
    },
    required: ['platform', 'chatId', 'text'],
  },
  async execute(input: unknown, _context: ToolContext) {
    const { platform, chatId, text } = input as {
      platform: 'telegram' | 'discord';
      chatId: string;
      text: string;
    };

    // TODO: Implement actual message sending via gateway
    // This is a skeleton implementation for Phase 13 (Tool Parity)
    const messageId = `msg_${Date.now()}`;

    return {
      result: { type: 'json', value: { messageId, status: 'sent' } },
    };
  },
});

export { TOOL };
export default TOOL;
