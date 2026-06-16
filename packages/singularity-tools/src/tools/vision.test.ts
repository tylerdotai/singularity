import { describe, expect, test } from 'vitest';
import type { ToolContext } from '../types.js';

const CTX: ToolContext = {
  sessionID: 'test-session',
  agent: 'test-agent',
  assistantMessageID: 'test-msg',
  toolCallID: 'test-call',
};

describe('vision_analyze tool', () => {
  test('has correct metadata', async () => {
    const { TOOL } = await import('./vision.js');
    expect(TOOL.name).toBe('vision_analyze');
    expect(TOOL.riskScore).toBe('LOW');
  });

  test('returns analysis result for valid image URL', async () => {
    const { TOOL } = await import('./vision.js');
    const result = await TOOL.execute(
      {
        imageUrl: 'https://example.com/image.jpg',
        prompt: 'Describe this image',
      },
      CTX
    );
    expect(result.result.type).toBe('json');
    const val = (result.result as unknown as { type: 'string'; value: unknown })
      .value as {
      description: string;
      tags: string[];
      confidence: number;
    };
    expect(val.description).toContain('Analysis guided by');
    expect(val.tags).toBeDefined();
    expect(Array.isArray(val.tags)).toBe(true);
    expect(val.confidence).toBeGreaterThan(0);
  });

  test('returns analysis without prompt', async () => {
    const { TOOL } = await import('./vision.js');
    const result = await TOOL.execute(
      { imageUrl: 'https://example.com/image.jpg' },
      CTX
    );
    expect(result.result.type).toBe('json');
    const val = (result.result as unknown as { type: 'string'; value: unknown })
      .value as {
      description: string;
    };
    expect(val.description).toBeDefined();
  });

  test('throws validation error for missing imageUrl', async () => {
    const { TOOL } = await import('./vision.js');
    await expect(TOOL.execute({}, CTX)).rejects.toThrow();
  });

  test('throws validation error for invalid URL', async () => {
    const { TOOL } = await import('./vision.js');
    await expect(
      TOOL.execute({ imageUrl: 'not-a-valid-url' }, CTX)
    ).rejects.toThrow();
  });
});
