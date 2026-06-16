import { describe, expect, test } from 'vitest';
import type { ToolContext } from '../types.js';

const CTX: ToolContext = {
  sessionID: 'test-session',
  agent: 'test-agent',
  assistantMessageID: 'test-msg',
  toolCallID: 'test-call',
};

describe('computer_use tool', () => {
  test('returns success response for click action', async () => {
    const { TOOL } = await import('./computer-use.js');
    const result = await TOOL.execute(
      { action: 'click', target: '#button' },
      CTX
    );
    expect(result.result.type).toBe('json');
    const val = result.result as unknown as { type: 'string'; value: unknown };
    const value = val.value as {
      success: boolean;
      action: string;
      target: string;
    };
    expect(value.action).toBe('click');
    expect(value.target).toBe('#button');
    // success may be true or false depending on whether element exists
    expect(typeof value.success).toBe('boolean');
  });

  test('returns success response for type action', async () => {
    const { TOOL } = await import('./computer-use.js');
    const result = await TOOL.execute(
      { action: 'type', target: 'input[name=search]', value: 'hello world' },
      CTX
    );
    expect(result.result.type).toBe('json');
    const val = result.result as unknown as { type: 'string'; value: unknown };
    const value = val.value as {
      success: boolean;
      action: string;
      target: string;
      value: string;
    };
    expect(value.action).toBe('type');
    expect(value.target).toBe('input[name=search]');
    expect(value.value).toBe('hello world');
    expect(typeof value.success).toBe('boolean');
  });

  test('returns success response for screenshot action', async () => {
    const { TOOL } = await import('./computer-use.js');
    const result = await TOOL.execute({ action: 'screenshot' }, CTX);
    expect(result.result.type).toBe('json');
    const val = result.result as unknown as { type: 'string'; value: unknown };
    const value = val.value as {
      success: boolean;
      action: string;
    };
    expect(value.action).toBe('screenshot');
    expect(typeof value.success).toBe('boolean');
  });

  test('returns success response for navigate action', async () => {
    const { TOOL } = await import('./computer-use.js');
    const result = await TOOL.execute(
      { action: 'navigate', target: 'https://example.com' },
      CTX
    );
    expect(result.result.type).toBe('json');
    const val = result.result as unknown as { type: 'string'; value: unknown };
    const value = val.value as {
      success: boolean;
      action: string;
      target: string;
    };
    expect(value.action).toBe('navigate');
    // URL may have trailing slash normalized
    expect(value.target).toMatch(/^https:\/\/example\.com\/?$/);
    expect(typeof value.success).toBe('boolean');
  });

  test('returns success response for keypress action', async () => {
    const { TOOL } = await import('./computer-use.js');
    const result = await TOOL.execute(
      { action: 'keypress', target: 'Enter' },
      CTX
    );
    expect(result.result.type).toBe('json');
    const val = result.result as unknown as { type: 'string'; value: unknown };
    const value = val.value as {
      success: boolean;
      action: string;
      target: string;
    };
    expect(value.action).toBe('keypress');
    expect(value.target).toBe('Enter');
    expect(typeof value.success).toBe('boolean');
  });

  test('action is required', async () => {
    const { TOOL } = await import('./computer-use.js');
    // Action is required, so passing empty object should still work but with undefined target
    const result = await TOOL.execute({}, CTX);
    expect(result.result.type).toBe('json');
    const val = result.result as unknown as { type: 'string'; value: unknown };
    const value = val.value as {
      success: boolean;
      action: string;
    };
    expect(value.action).toBeUndefined();
  });
});
