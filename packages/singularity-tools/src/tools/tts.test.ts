import { describe, expect, test } from 'vitest';
import type { ToolContext } from '../types.js';

const CTX: ToolContext = {
  sessionID: 'test-session',
  agent: 'test-agent',
  assistantMessageID: 'test-msg',
  toolCallID: 'test-call',
};

describe('text_to_speech tool', () => {
  test('has correct metadata', async () => {
    const { TOOL } = await import('./tts.js');
    expect(TOOL.name).toBe('text_to_speech');
    expect(TOOL.riskScore).toBe('LOW');
    expect(TOOL.approvalRequired).toBe(false);
  });

  test('synthesizes speech with default voice and model', async () => {
    const { TOOL } = await import('./tts.js');
    const result = await TOOL.execute({ text: 'Hello, world!' }, CTX);
    expect(result.result.type).toBe('json');
    const val = (result.result as unknown as { type: 'string'; value: unknown })
      .value as { audioUrl: string; durationSeconds: number };
    expect(val.audioUrl).toContain('https://api.example.com/tts/');
    expect(val.audioUrl).toContain('.mp3');
    expect(val.durationSeconds).toBeGreaterThan(0);
  });

  test('synthesizes speech with custom voice', async () => {
    const { TOOL } = await import('./tts.js');
    const result = await TOOL.execute(
      { text: 'Hello!', voice: 'shimmer' },
      CTX
    );
    expect(result.result.type).toBe('json');
  });

  test('synthesizes speech with custom model', async () => {
    const { TOOL } = await import('./tts.js');
    const result = await TOOL.execute(
      { text: 'Hello!', model: 'tts-1-hd' },
      CTX
    );
    expect(result.result.type).toBe('json');
  });

  test('calculates duration based on text length', async () => {
    const { TOOL } = await import('./tts.js');
    const shortText = 'Hi';
    const longText =
      'This is a much longer text that should take more time to read aloud';
    const shortResult = await TOOL.execute({ text: shortText }, CTX);
    const longResult = await TOOL.execute({ text: longText }, CTX);

    const shortVal = (
      shortResult.result as unknown as { type: 'string'; value: unknown }
    ).value as { durationSeconds: number };
    const longVal = (
      longResult.result as unknown as { type: 'string'; value: unknown }
    ).value as { durationSeconds: number };

    expect(longVal.durationSeconds).toBeGreaterThan(shortVal.durationSeconds);
  });

  test('throws validation error for missing text', async () => {
    const { TOOL } = await import('./tts.js');
    await expect(TOOL.execute({}, CTX)).rejects.toThrow();
  });
});
