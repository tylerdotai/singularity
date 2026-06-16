import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createMiniMaxAdapter, MiniMaxAdapter } from './minimax';
import type { LLMEvent, Message } from './types';

// ---------------------------------------------------------------------------
// Mock fetch helper
// ---------------------------------------------------------------------------

function mockFetch(response: {
  status?: number;
  body?: string;
  ok?: boolean;
}): void {
  const status = response.status ?? 200;
  const body = response.body ?? '';
  globalThis.fetch = (async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(body));
        controller.close();
      },
    });
    return {
      ok: response.ok ?? status === 200,
      status,
      statusText: status === 200 ? 'OK' : 'Error',
      body: stream,
    };
  }) as any;
}

let originalFetch: any;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function makeSSE(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function textChunk(
  id: string,
  content: string,
  finishReason?: string,
  usage?: Record<string, unknown>
): string {
  const chunk: Record<string, unknown> = {
    id,
    choices: [
      {
        index: 0,
        delta: { content },
        ...(finishReason ? { finish_reason: finishReason } : {}),
      },
    ],
    usage: usage ?? null,
    base_resp: { status_code: 0, status_msg: '' },
  };
  return `data: ${JSON.stringify(chunk)}\n\n`;
}

function reasoningChunk(id: string, content: string): string {
  const chunk: Record<string, unknown> = {
    id,
    choices: [{ index: 0, delta: { reasoning_content: content } }],
    base_resp: { status_code: 0, status_msg: '' },
  };
  return `data: ${JSON.stringify(chunk)}\n\n`;
}

function toolCallChunk(
  id: string,
  index: number,
  toolCallId: string,
  name: string,
  args: string,
  finishReason?: string
): string {
  const chunk: Record<string, unknown> = {
    id,
    choices: [
      {
        index,
        delta: {
          tool_calls: [
            { index, id: toolCallId, function: { name, arguments: args } },
          ],
        },
        ...(finishReason ? { finish_reason: finishReason } : {}),
      },
    ],
    ...(finishReason
      ? {
          usage: {
            total_tokens: 100,
            prompt_tokens: 50,
            completion_tokens: 50,
          },
        }
      : {}),
    base_resp: { status_code: 0, status_msg: '' },
  };
  return `data: ${JSON.stringify(chunk)}\n\n`;
}

function doneChunk(): string {
  return 'data: [DONE]\n\n';
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MiniMaxAdapter', () => {
  describe('text-delta events', () => {
    test('emits text-delta events from content delta', async () => {
      const sse = textChunk('chatcmpl-123', 'Hello', 'stop', {
        total_tokens: 5,
        prompt_tokens: 2,
        completion_tokens: 3,
      });
      mockFetch({ status: 200, body: sse });

      const adapter = new MiniMaxAdapter('test-key');
      const events: LLMEvent[] = [];
      for await (const e of adapter.chat([
        { role: 'user', content: [{ type: 'text', text: 'hi' }] },
      ])) {
        events.push(e);
      }

      expect(events).toContainEqual({
        type: 'text-delta',
        id: 'chatcmpl-123',
        text: 'Hello',
      });
      expect(events).toContainEqual({
        type: 'finish',
        reason: 'stop',
        usage: undefined,
      });
    });
  });

  describe('reasoning-delta events', () => {
    test('emits reasoning-delta when reasoningSplit enabled', async () => {
      const sse =
        reasoningChunk('chatcmpl-123', 'Let me think...') +
        textChunk('chatcmpl-123', 'The answer is 42.', 'stop', {
          total_tokens: 50,
          prompt_tokens: 20,
          completion_tokens: 30,
        });
      mockFetch({ status: 200, body: sse });

      const adapter = new MiniMaxAdapter('test-key');
      const events: LLMEvent[] = [];
      for await (const e of adapter.chat(
        [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
        { reasoningSplit: true }
      )) {
        events.push(e);
      }

      expect(events).toContainEqual({
        type: 'reasoning-delta',
        id: 'reasoning-0',
        text: 'Let me think...',
      });
    });

    test('no reasoning-delta when reasoningSplit disabled (default)', async () => {
      const sse = textChunk('chatcmpl-123', 'Hello', 'stop', {
        total_tokens: 5,
        prompt_tokens: 2,
        completion_tokens: 3,
      });
      mockFetch({ status: 200, body: sse });

      const adapter = new MiniMaxAdapter('test-key');
      const events: LLMEvent[] = [];
      for await (const e of adapter.chat([
        { role: 'user', content: [{ type: 'text', text: 'hi' }] },
      ])) {
        events.push(e);
      }

      const reasoningEvents = events.filter(
        (e) => e.type === 'reasoning-delta'
      );
      expect(reasoningEvents).toHaveLength(0);
    });
  });

  describe('tool-call events', () => {
    test('tool-call event with name and parsed input', async () => {
      const sse =
        toolCallChunk(
          'chatcmpl-123',
          0,
          'call_abc123',
          'get_weather',
          '{"location":"SF"}',
          'tool_calls'
        ) +
        textChunk('chatcmpl-123', '', 'tool_calls', {
          total_tokens: 100,
          prompt_tokens: 50,
          completion_tokens: 50,
        });
      mockFetch({ status: 200, body: sse });

      const adapter = new MiniMaxAdapter('test-key');
      const events: LLMEvent[] = [];
      for await (const e of adapter.chat([
        { role: 'user', content: [{ type: 'text', text: 'weather?' }] },
      ])) {
        events.push(e);
      }

      const toolCallEvents = events.filter((e) => e.type === 'tool-call');
      expect(toolCallEvents).toContainEqual({
        type: 'tool-call',
        id: 'call_abc123',
        name: 'get_weather',
        input: { location: 'SF' },
      });
    });

    test('multiple tool calls in one response', async () => {
      const sse =
        toolCallChunk(
          'chatcmpl-123',
          0,
          'call_1',
          'tool_a',
          '{"a":1}',
          'tool_calls'
        ) +
        toolCallChunk(
          'chatcmpl-123',
          1,
          'call_2',
          'tool_b',
          '{"b":2}',
          'tool_calls'
        ) +
        textChunk('chatcmpl-123', '', 'tool_calls', {
          total_tokens: 150,
          prompt_tokens: 75,
          completion_tokens: 75,
        });
      mockFetch({ status: 200, body: sse });

      const adapter = new MiniMaxAdapter('test-key');
      const events: LLMEvent[] = [];
      for await (const e of adapter.chat([
        { role: 'user', content: [{ type: 'text', text: 'do both' }] },
      ])) {
        events.push(e);
      }

      const toolCallEvents = events.filter((e) => e.type === 'tool-call');
      expect(toolCallEvents).toHaveLength(2);
      expect(toolCallEvents[0]).toMatchObject({
        name: 'tool_a',
        input: { a: 1 },
      });
      expect(toolCallEvents[1]).toMatchObject({
        name: 'tool_b',
        input: { b: 2 },
      });
    });
  });

  describe('usage mapping', () => {
    test('step-finish carries usage with all token fields', async () => {
      const sse = textChunk('chatcmpl-123', 'Hi', 'stop', {
        total_tokens: 50,
        prompt_tokens: 20,
        completion_tokens: 30,
        prompt_tokens_details: { cached_tokens: 10 },
      });
      mockFetch({ status: 200, body: sse });

      const adapter = new MiniMaxAdapter('test-key');
      const events: LLMEvent[] = [];
      for await (const e of adapter.chat([
        { role: 'user', content: [{ type: 'text', text: 'hi' }] },
      ])) {
        events.push(e);
      }

      const finishEvents = events.filter((e) => e.type === 'step-finish');
      expect(finishEvents.length).toBeGreaterThan(0);
      const finish = finishEvents[0] as unknown as {
        type: 'step-finish';
        usage: Record<string, unknown>;
      };
      expect(finish.usage).toMatchObject({
        inputTokens: 20,
        outputTokens: 30,
        totalTokens: 50,
        cacheHitInputTokens: 10,
      });
    });

    test('finish event emitted at end of stream', async () => {
      const sse = textChunk('chatcmpl-123', 'Hello', 'stop', {
        total_tokens: 5,
        prompt_tokens: 2,
        completion_tokens: 3,
      });
      mockFetch({ status: 200, body: sse });

      const adapter = new MiniMaxAdapter('test-key');
      const events: LLMEvent[] = [];
      for await (const e of adapter.chat([
        { role: 'user', content: [{ type: 'text', text: 'hi' }] },
      ])) {
        events.push(e);
      }

      expect(events).toContainEqual({
        type: 'finish',
        reason: 'stop',
        usage: undefined,
      });
    });
  });

  describe('provider errors', () => {
    test('provider-error on HTTP 401', async () => {
      mockFetch({ status: 401, ok: false, body: '' });

      const adapter = new MiniMaxAdapter('bad-key');
      const events: LLMEvent[] = [];
      for await (const e of adapter.chat([
        { role: 'user', content: [{ type: 'text', text: 'hi' }] },
      ])) {
        events.push(e);
      }

      expect(events).toContainEqual(
        expect.objectContaining({
          type: 'provider-error',
          retryable: false,
        })
      );
    });

    test('provider-error on HTTP 429 is retryable', async () => {
      mockFetch({ status: 429, ok: false, body: '' });

      const adapter = new MiniMaxAdapter('rate-limited-key');
      const events: LLMEvent[] = [];
      for await (const e of adapter.chat([
        { role: 'user', content: [{ type: 'text', text: 'hi' }] },
      ])) {
        events.push(e);
      }

      expect(events).toContainEqual(
        expect.objectContaining({
          type: 'provider-error',
          retryable: true,
        })
      );
    });

    test('provider-error on HTTP 500 is retryable', async () => {
      mockFetch({ status: 500, ok: false, body: '' });

      const adapter = new MiniMaxAdapter('server-error-key');
      const events: LLMEvent[] = [];
      for await (const e of adapter.chat([
        { role: 'user', content: [{ type: 'text', text: 'hi' }] },
      ])) {
        events.push(e);
      }

      expect(events).toContainEqual(
        expect.objectContaining({
          type: 'provider-error',
          retryable: true,
        })
      );
    });

    test('provider-error on non-zero base_resp.status_code', async () => {
      const errorChunk: Record<string, unknown> = {
        id: 'chatcmpl-err',
        choices: [],
        base_resp: {
          status_code: 1001,
          status_msg: 'content filter triggered',
        },
      };
      const sse = `data: ${JSON.stringify(errorChunk)}\n\n`;
      mockFetch({ status: 200, body: sse });

      const adapter = new MiniMaxAdapter('test-key');
      const events: LLMEvent[] = [];
      for await (const e of adapter.chat([
        { role: 'user', content: [{ type: 'text', text: 'hi' }] },
      ])) {
        events.push(e);
      }

      expect(events).toContainEqual(
        expect.objectContaining({
          type: 'provider-error',
          message: 'content filter triggered',
          retryable: false,
        })
      );
    });
  });

  describe('finish reason mapping', () => {
    test('finish_reason "stop" → "stop"', async () => {
      const sse = textChunk('chatcmpl-123', 'Hi', 'stop', {
        total_tokens: 5,
        prompt_tokens: 2,
        completion_tokens: 3,
      });
      mockFetch({ status: 200, body: sse });

      const adapter = new MiniMaxAdapter('test-key');
      const events: LLMEvent[] = [];
      for await (const e of adapter.chat([
        { role: 'user', content: [{ type: 'text', text: 'hi' }] },
      ])) {
        events.push(e);
      }

      const stepFinish = events.find((e) => e.type === 'step-finish');
      expect(stepFinish).toMatchObject({ type: 'step-finish', reason: 'stop' });
    });

    test('finish_reason "tool_calls" → "tool_calls"', async () => {
      const sse =
        toolCallChunk(
          'chatcmpl-123',
          0,
          'call_x',
          'test_tool',
          '{}',
          'tool_calls'
        ) +
        textChunk('chatcmpl-123', '', 'tool_calls', {
          total_tokens: 50,
          prompt_tokens: 25,
          completion_tokens: 25,
        });
      mockFetch({ status: 200, body: sse });

      const adapter = new MiniMaxAdapter('test-key');
      const events: LLMEvent[] = [];
      for await (const e of adapter.chat([
        { role: 'user', content: [{ type: 'text', text: 'call tool' }] },
      ])) {
        events.push(e);
      }

      const stepFinish = events.find((e) => e.type === 'step-finish');
      expect(stepFinish).toMatchObject({
        type: 'step-finish',
        reason: 'tool_calls',
      });
    });
  });

  describe('createMiniMaxAdapter', () => {
    test('creates adapter with correct provider', () => {
      const adapter = createMiniMaxAdapter({ apiKey: 'test-key' });
      expect(adapter.provider).toBe('minimax');
    });

    test('defaults model to MiniMax-M3', () => {
      const adapter = createMiniMaxAdapter({ apiKey: 'test-key' });
      expect(adapter.model).toBe('MiniMax-M3');
    });

    test('uses explicit model when provided', () => {
      const adapter = createMiniMaxAdapter({
        apiKey: 'test-key',
        model: 'MiniMax-M2.7',
      });
      expect(adapter.model).toBe('MiniMax-M2.7');
    });

    test('uses explicit baseURL when provided', () => {
      const adapter = createMiniMaxAdapter({
        apiKey: 'test-key',
        baseURL: 'https://custom.io/v1',
      });
      // adapter is created without error
      expect(adapter.provider).toBe('minimax');
    });
  });

  describe('empty response body', () => {
    test('emits provider-error on empty body', async () => {
      globalThis.fetch = (async () => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        body: null,
      })) as any;

      const adapter = new MiniMaxAdapter('test-key');
      const events: LLMEvent[] = [];
      for await (const e of adapter.chat([
        { role: 'user', content: [{ type: 'text', text: 'hi' }] },
      ])) {
        events.push(e);
      }

      expect(events).toContainEqual(
        expect.objectContaining({
          type: 'provider-error',
          message: 'Empty response body',
          retryable: false,
        })
      );
    });
  });
});
