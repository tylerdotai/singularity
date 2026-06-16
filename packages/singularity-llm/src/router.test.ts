// Tests for singularity-llm router, usage, and pool

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { ProviderError } from './errors';
import { callWithFallback, type FallbackConfig } from './pool';
import { createLLM, getApiKey, type LLMAdapter, routeModel } from './router';
import type { LLMEvent, Message } from './types';
import { type SessionUsage, UsageTracker } from './usage';

// ---------- Mock adapter helpers ----------

function mockAdapter(provider: 'openai' | 'minimax' | 'anthropic'): LLMAdapter {
  return {
    provider,
    model:
      provider === 'openai'
        ? 'gpt-4o'
        : provider === 'minimax'
          ? 'MiniMax-Text-01'
          : 'claude-3-5-sonnet',
    async *chat() {},
  };
}

function mockAdapterWithEvents(events: LLMEvent[]): LLMAdapter {
  return {
    provider: 'openai',
    model: 'gpt-4o',
    async *chat() {
      for (const event of events) {
        yield event;
      }
    },
  };
}

function mockFailingAdapter(status: number, retryable: boolean): LLMAdapter {
  return {
    provider: 'openai',
    model: 'gpt-4o',
    // biome-ignore lint/correctness/useYield: intentionally async generator that throws immediately (used in fallback tests)
    async *chat() {
      throw new ProviderError(`HTTP ${status}`, String(status), retryable);
    },
  };
}

// ---------- routeModel tests ----------

describe('routeModel', () => {
  test('gpt-4o → openai', () => {
    expect(routeModel('gpt-4o')).toBe('openai');
  });

  test('claude-3-5-sonnet → anthropic', () => {
    expect(routeModel('claude-3-5-sonnet')).toBe('anthropic');
  });

  test('gpt-4o-mini → openai', () => {
    expect(routeModel('gpt-4o-mini')).toBe('openai');
  });

  test('o1-preview → openai', () => {
    expect(routeModel('o1-preview')).toBe('openai');
  });

  test('unknown-model → defaults to openai', () => {
    expect(routeModel('unknown-model')).toBe('openai');
  });

  test('MiniMax-Text-01 → minimax', () => {
    expect(routeModel('MiniMax-Text-01')).toBe('minimax');
  });

  test('MiniMax-Embed-01 → minimax', () => {
    expect(routeModel('MiniMax-Embed-01')).toBe('minimax');
  });
});

// ---------- UsageTracker tests ----------

describe('UsageTracker', () => {
  let tracker: UsageTracker;

  beforeEach(() => {
    tracker = new UsageTracker();
  });

  test('record() accumulates tokens', () => {
    tracker.record(
      { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
      'openai'
    );
    tracker.record(
      { inputTokens: 200, outputTokens: 100, totalTokens: 300 },
      'anthropic'
    );

    const usage = tracker.get();
    expect(usage.openai?.inputTokens).toBe(100);
    expect(usage.openai?.outputTokens).toBe(50);
    expect(usage.anthropic?.inputTokens).toBe(200);
    expect(usage.anthropic?.outputTokens).toBe(100);
  });

  test('get() returns cumulative totals', () => {
    tracker.record({ inputTokens: 100, outputTokens: 50, totalTokens: 150 });
    tracker.record({ inputTokens: 200, outputTokens: 100, totalTokens: 300 });

    const usage = tracker.get();
    expect(usage.totalInputTokens).toBe(300);
    expect(usage.totalOutputTokens).toBe(150);
    expect(usage.totalTokens).toBe(450);
  });

  test('reset() clears all usage', () => {
    tracker.record({ inputTokens: 100, outputTokens: 50, totalTokens: 150 });
    tracker.reset();

    const usage = tracker.get();
    expect(usage.totalInputTokens).toBe(0);
    expect(usage.totalOutputTokens).toBe(0);
    expect(usage.totalTokens).toBe(0);
  });
});

// ---------- callWithFallback tests ----------

describe('callWithFallback', () => {
  const testMessages: ReadonlyArray<Message> = [
    { role: 'user', content: [{ type: 'text', text: 'hello' }] },
  ];

  test('primary 200 → yields events from primary', async () => {
    const primaryEvents: LLMEvent[] = [
      { type: 'text-start', id: '1' },
      { type: 'text-delta', id: '1', text: 'hi' },
      { type: 'finish', reason: 'stop' },
    ];
    const primary = mockAdapterWithEvents(primaryEvents);
    const config: FallbackConfig = {
      primary: { adapter: primary, model: 'gpt-4o' },
    };

    const events: LLMEvent[] = [];
    for await (const event of callWithFallback(config, testMessages)) {
      events.push(event);
    }

    expect(events.length).toBe(3);
    expect(events[0].type).toBe('text-start');
    expect(events[1].type).toBe('text-delta');
    expect(events[2].type).toBe('finish');
  });

  test('primary 429 → yields from fallback', async () => {
    const primary = mockFailingAdapter(429, true);
    const fallbackEvents: LLMEvent[] = [
      { type: 'text-start', id: '2' },
      { type: 'text-delta', id: '2', text: 'fallback response' },
      { type: 'finish', reason: 'stop' },
    ];
    const fallback = mockAdapterWithEvents(fallbackEvents);
    const config: FallbackConfig = {
      primary: { adapter: primary, model: 'gpt-4o' },
      fallback: { adapter: fallback, model: 'gpt-4o' },
    };

    const events: LLMEvent[] = [];
    for await (const event of callWithFallback(config, testMessages)) {
      events.push(event);
    }

    expect(events.length).toBe(3);
    expect(events[0].type).toBe('text-start');
    expect(events[1].type).toBe('text-delta');
    expect((events[1] as { text: string }).text).toBe('fallback response');
  });

  test('both fail → final provider-error', async () => {
    const primary = mockFailingAdapter(500, true);
    const fallback = mockFailingAdapter(500, true);
    const config: FallbackConfig = {
      primary: { adapter: primary, model: 'gpt-4o' },
      fallback: { adapter: fallback, model: 'gpt-4o' },
    };

    await expect(callWithFallback(config, testMessages).next()).rejects.toThrow(
      'HTTP 500'
    );
  });

  test('non-retryable primary error → propagates without fallback', async () => {
    const primary = mockFailingAdapter(400, false);
    const fallback = mockAdapterWithEvents([
      { type: 'finish', reason: 'stop' },
    ]);
    const config: FallbackConfig = {
      primary: { adapter: primary, model: 'gpt-4o' },
      fallback: { adapter: fallback, model: 'gpt-4o' },
    };

    await expect(callWithFallback(config, testMessages).next()).rejects.toThrow(
      'HTTP 400'
    );
  });
});

// ---------- getApiKey tests ----------

describe('getApiKey', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  test('returns OPENAI_API_KEY for openai', () => {
    process.env.OPENAI_API_KEY = 'sk-test-openai';
    expect(getApiKey('openai')).toBe('sk-test-openai');
  });

  test('returns ANTHROPIC_API_KEY for anthropic', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    expect(getApiKey('anthropic')).toBe('sk-ant-test');
  });

  test('returns undefined when key not set', () => {
    process.env.OPENAI_API_KEY = undefined;
    process.env.ANTHROPIC_API_KEY = undefined;
    process.env.MINIMAX_API_KEY = undefined;
    expect(getApiKey('openai')).toBeUndefined();
    expect(getApiKey('anthropic')).toBeUndefined();
    expect(getApiKey('minimax')).toBeUndefined();
  });

  test('returns MINIMAX_API_KEY for minimax', () => {
    process.env.MINIMAX_API_KEY = 'minimax-test-key';
    expect(getApiKey('minimax')).toBe('minimax-test-key');
  });
});

// ---------- createLLM tests ----------

describe('createLLM', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  test('prefers OpenAI when both keys available', () => {
    process.env.OPENAI_API_KEY = 'sk-test-openai';
    process.env.ANTHROPIC_API_KEY = 'sk-test-ant';
    const adapter = createLLM();
    expect(adapter.provider).toBe('openai');
  });

  test('falls back to Anthropic when OpenAI key missing', () => {
    process.env.OPENAI_API_KEY = undefined;
    process.env.MINIMAX_API_KEY = undefined;
    process.env.ANTHROPIC_API_KEY = 'sk-test-ant';
    const adapter = createLLM();
    expect(adapter.provider).toBe('anthropic');
  });

  test('uses explicit openAIKey option', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test-ant';
    const adapter = createLLM({ openAIKey: 'sk-explicit-openai' });
    expect(adapter.provider).toBe('openai');
  });

  test('uses explicit anthropicKey option', () => {
    process.env.OPENAI_API_KEY = undefined;
    process.env.MINIMAX_API_KEY = undefined;
    const adapter = createLLM({ anthropicKey: 'sk-explicit-ant' });
    expect(adapter.provider).toBe('anthropic');
  });

  test('prefers OpenAI > MiniMax > Anthropic when all keys available', () => {
    process.env.OPENAI_API_KEY = 'sk-openai';
    process.env.MINIMAX_API_KEY = 'sk-minimax';
    process.env.ANTHROPIC_API_KEY = 'sk-ant';
    const adapter = createLLM();
    expect(adapter.provider).toBe('openai');
  });

  test('falls back to MiniMax when OpenAI key missing', () => {
    process.env.OPENAI_API_KEY = undefined;
    process.env.MINIMAX_API_KEY = 'sk-minimax';
    process.env.ANTHROPIC_API_KEY = 'sk-ant';
    const adapter = createLLM();
    expect(adapter.provider).toBe('minimax');
  });

  test('uses explicit minimaxKey option', () => {
    process.env.OPENAI_API_KEY = undefined;
    const adapter = createLLM({ minimaxKey: 'sk-explicit-minimax' });
    expect(adapter.provider).toBe('minimax');
  });
});
