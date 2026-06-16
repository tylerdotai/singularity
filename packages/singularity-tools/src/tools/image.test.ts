import { describe, expect, test } from 'vitest';
import type { ToolContext } from '../types.js';

const CTX: ToolContext = {
  sessionID: 'test-session',
  agent: 'test-agent',
  assistantMessageID: 'test-msg',
  toolCallID: 'test-call',
};

describe('image_generate tool', () => {
  test('has correct metadata', async () => {
    const { TOOL } = await import('./image.js');
    expect(TOOL.name).toBe('image_generate');
    expect(TOOL.riskScore).toBe('LOW');
  });

  test('generates image with default size', async () => {
    const { TOOL } = await import('./image.js');
    const result = await TOOL.execute(
      { prompt: 'A beautiful sunset over mountains' },
      CTX
    );
    expect(result.result.type).toBe('json');
    const val = (result.result as unknown as { type: 'string'; value: unknown })
      .value as {
      url: string;
      revisedPrompt: string;
    };
    expect(val.url).toContain('https://placeholder.example.com/generated/');
    expect(val.revisedPrompt).toBe('A beautiful sunset over mountains');
  });

  test('generates image with custom size', async () => {
    const { TOOL } = await import('./image.js');
    const result = await TOOL.execute(
      { prompt: 'A cat', size: '512x512' },
      CTX
    );
    expect(result.result.type).toBe('json');
  });

  test('throws validation error for empty prompt', async () => {
    const { TOOL } = await import('./image.js');
    await expect(TOOL.execute({ prompt: '' }, CTX)).rejects.toThrow();
  });

  test('throws validation error for missing prompt', async () => {
    const { TOOL } = await import('./image.js');
    await expect(TOOL.execute({}, CTX)).rejects.toThrow();
  });
});
