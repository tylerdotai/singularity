import { describe, expect, test } from 'vitest';
import type { ToolContext } from '../types.js';

const CTX: ToolContext = {
  sessionID: 'test-session',
  agent: 'test-agent',
  assistantMessageID: 'test-msg',
  toolCallID: 'test-call',
};

describe('send_message tool', () => {
  test('has correct metadata', async () => {
    const { TOOL } = await import('./send-message.js');
    expect(TOOL.name).toBe('send_message');
    expect(TOOL.riskScore).toBe('HIGH');
    expect(TOOL.approvalRequired).toBe(true);
  });

  test('sends message to telegram', async () => {
    const { TOOL } = await import('./send-message.js');
    const result = await TOOL.execute(
      {
        platform: 'telegram',
        chatId: '123456789',
        text: 'Hello from bot!',
      },
      CTX
    );
    expect(result.result.type).toBe('json');
    const val = (result.result as unknown as { type: 'string'; value: unknown })
      .value as { messageId: string; status: string };
    expect(val.messageId).toMatch(/^msg_\d+$/);
    expect(val.status).toBe('sent');
  });

  test('sends message to discord', async () => {
    const { TOOL } = await import('./send-message.js');
    const result = await TOOL.execute(
      {
        platform: 'discord',
        chatId: '987654321',
        text: 'Hello from bot!',
      },
      CTX
    );
    expect(result.result.type).toBe('json');
    const val = (result.result as unknown as { type: 'string'; value: unknown })
      .value as { messageId: string; status: string };
    expect(val.status).toBe('sent');
  });

  test('returns message with all fields', async () => {
    const { TOOL } = await import('./send-message.js');
    const result = await TOOL.execute(
      {
        platform: 'telegram',
        chatId: '123456789',
        text: 'Test message',
      },
      CTX
    );
    expect(result.result.type).toBe('json');
    const val = (result.result as unknown as { type: 'string'; value: unknown })
      .value as { messageId: string; status: string };
    expect(val.messageId).toBeDefined();
    expect(val.status).toBe('sent');
  });
});
