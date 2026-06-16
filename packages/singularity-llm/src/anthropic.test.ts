import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { AnthropicAdapter } from './anthropic';
import type { Message, ToolDefinition } from './types';

// ---------------------------------------------------------------------------
// Mock server helper
// ---------------------------------------------------------------------------

type MockHandler = (req: Request) => Response | Promise<Response>;

let server: { port: number; stop: () => void } | null = null;

async function startMockServer(handler: MockHandler): Promise<number> {
  const srv = Bun.serve({
    port: 0,
    async fetch(req) {
      return handler(req);
    },
  });
  server = srv as typeof server;
  return srv.port;
}

function stopMockServer() {
  if (server) {
    server.stop();
    server = null;
  }
}

// ---------------------------------------------------------------------------
// SSE helpers
// ---------------------------------------------------------------------------

function sse(data: object | object[]): string {
  const lines = Array.isArray(data)
    ? data.map((d) => `data: ${JSON.stringify(d)}`).join('\n')
    : `data: ${JSON.stringify(data)}`;
  return `${lines}\n\n`;
}

function makeSSE(parts: Array<{ event: string; data: object }>): string {
  return parts
    .map((p) => `event: ${p.event}\ndata: ${JSON.stringify(p.data)}\n\n`)
    .join('');
}

// ---------------------------------------------------------------------------
// Test 1: text-delta events from text content_block
// ---------------------------------------------------------------------------

test('Test 1: text-delta events from text content_block', async () => {
  const events: string[] = [];
  const port = await startMockServer((req) => {
    events.push(`${req.method} ${req.url}`);
    const body = makeSSE([
      {
        event: 'message_start',
        data: { type: 'message_start', message: { usage: {} } },
      },
      {
        event: 'content_block_start',
        data: {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text', text: 'Hello' },
        },
      },
      {
        event: 'content_block_delta',
        data: {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: ' world' },
        },
      },
      {
        event: 'content_block_delta',
        data: {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: '!' },
        },
      },
      {
        event: 'content_block_stop',
        data: { type: 'content_block_stop', index: 0 },
      },
      {
        event: 'message_delta',
        data: {
          type: 'message_delta',
          delta: { stop_reason: 'end_turn' },
          usage: { input_tokens: 10, output_tokens: 5 },
        },
      },
      { event: 'message_stop', data: { type: 'message_stop' } },
    ]);
    return new Response(body, {
      headers: { 'Content-Type': 'text/event-stream' },
    });
  });

  try {
    const adapter = new AnthropicAdapter(
      'test-key',
      `http://localhost:${port}`
    );
    const messages: Message[] = [
      { role: 'user', content: [{ type: 'text', text: 'hi' }] },
    ];
    const result: string[] = [];

    for await (const event of adapter.messages('claude-3-5-sonnet', messages)) {
      if (event.type === 'text-delta') result.push(event.text);
    }

    expect(result).toEqual([' world', '!']);
    expect(events[0]).toMatch(/POST/);
  } finally {
    stopMockServer();
  }
});

// ---------------------------------------------------------------------------
// Test 2: tool-use block → tool-call event with name + input
// ---------------------------------------------------------------------------

test('Test 2: tool-use block → tool-call event with name + input', async () => {
  const port = await startMockServer(() => {
    const body = makeSSE([
      {
        event: 'message_start',
        data: { type: 'message_start', message: { usage: {} } },
      },
      {
        event: 'content_block_start',
        data: {
          type: 'content_block_start',
          index: 0,
          content_block: {
            type: 'tool_use',
            id: 'toolu_1',
            name: 'get_weather',
          },
        },
      },
      {
        event: 'content_block_delta',
        data: {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'input_json_delta', partial_json: '{"city":' },
        },
      },
      {
        event: 'content_block_delta',
        data: {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'input_json_delta', partial_json: '"Seattle"}' },
        },
      },
      {
        event: 'content_block_stop',
        data: { type: 'content_block_stop', index: 0 },
      },
      {
        event: 'message_delta',
        data: {
          type: 'message_delta',
          delta: { stop_reason: 'end_turn' },
          usage: { input_tokens: 10, output_tokens: 5 },
        },
      },
      { event: 'message_stop', data: { type: 'message_stop' } },
    ]);
    return new Response(body, {
      headers: { 'Content-Type': 'text/event-stream' },
    });
  });

  try {
    const adapter = new AnthropicAdapter(
      'test-key',
      `http://localhost:${port}`
    );
    const messages: Message[] = [
      { role: 'user', content: [{ type: 'text', text: 'weather' }] },
    ];
    const tools: ToolDefinition[] = [
      {
        name: 'get_weather',
        description: 'Get weather',
        inputSchema: { type: 'object' },
      },
    ];
    let toolCallName = '';
    let toolCallId = '';

    for await (const event of adapter.messages(
      'claude-3-5-sonnet',
      messages,
      tools
    )) {
      if (event.type === 'tool-call') {
        toolCallName = event.name;
        toolCallId = event.id;
      }
    }

    expect(toolCallName).toEqual('get_weather');
    expect(toolCallId).toEqual('toolu_1');
  } finally {
    stopMockServer();
  }
});

// ---------------------------------------------------------------------------
// Test 3: stop_reason end_turn → FinishReason "stop"
// ---------------------------------------------------------------------------

test('Test 3: stop_reason end_turn → FinishReason stop', async () => {
  const port = await startMockServer(() => {
    const body = makeSSE([
      {
        event: 'message_start',
        data: { type: 'message_start', message: { usage: {} } },
      },
      {
        event: 'content_block_start',
        data: {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text', text: 'Hi' },
        },
      },
      {
        event: 'content_block_stop',
        data: { type: 'content_block_stop', index: 0 },
      },
      {
        event: 'message_delta',
        data: {
          type: 'message_delta',
          delta: { stop_reason: 'end_turn' },
          usage: { input_tokens: 10, output_tokens: 5 },
        },
      },
      { event: 'message_stop', data: { type: 'message_stop' } },
    ]);
    return new Response(body, {
      headers: { 'Content-Type': 'text/event-stream' },
    });
  });

  try {
    const adapter = new AnthropicAdapter(
      'test-key',
      `http://localhost:${port}`
    );
    const messages: Message[] = [
      { role: 'user', content: [{ type: 'text', text: 'hi' }] },
    ];
    let finishReason = '';

    for await (const event of adapter.messages('claude-3-5-sonnet', messages)) {
      if (event.type === 'finish') {
        finishReason = event.reason;
      }
    }

    expect(finishReason).toEqual('stop');
  } finally {
    stopMockServer();
  }
});

// ---------------------------------------------------------------------------
// Test 4: stop_reason max_tokens → FinishReason "max_tokens"
// ---------------------------------------------------------------------------

test('Test 4: stop_reason max_tokens → FinishReason max_tokens', async () => {
  const port = await startMockServer(() => {
    const body = makeSSE([
      {
        event: 'message_start',
        data: { type: 'message_start', message: { usage: {} } },
      },
      {
        event: 'content_block_start',
        data: {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text', text: 'Hi' },
        },
      },
      {
        event: 'content_block_stop',
        data: { type: 'content_block_stop', index: 0 },
      },
      {
        event: 'message_delta',
        data: {
          type: 'message_delta',
          delta: { stop_reason: 'max_tokens' },
          usage: { input_tokens: 10, output_tokens: 4096 },
        },
      },
      { event: 'message_stop', data: { type: 'message_stop' } },
    ]);
    return new Response(body, {
      headers: { 'Content-Type': 'text/event-stream' },
    });
  });

  try {
    const adapter = new AnthropicAdapter(
      'test-key',
      `http://localhost:${port}`
    );
    const messages: Message[] = [
      { role: 'user', content: [{ type: 'text', text: 'hi' }] },
    ];
    let finishReason = '';

    for await (const event of adapter.messages('claude-3-5-sonnet', messages)) {
      if (event.type === 'finish') {
        finishReason = event.reason;
      }
    }

    expect(finishReason).toEqual('max_tokens');
  } finally {
    stopMockServer();
  }
});

// ---------------------------------------------------------------------------
// Test 5: thinking block → reasoning-start/delta/end events
// ---------------------------------------------------------------------------

test('Test 5: thinking block → reasoning-start/delta/end events', async () => {
  const port = await startMockServer(() => {
    const body = makeSSE([
      {
        event: 'message_start',
        data: { type: 'message_start', message: { usage: {} } },
      },
      {
        event: 'content_block_start',
        data: {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'thinking', thinking: 'Let me think' },
        },
      },
      {
        event: 'content_block_delta',
        data: {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'thinking_delta', thinking: ' about this' },
        },
      },
      {
        event: 'content_block_delta',
        data: {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'thinking_delta', thinking: ' more' },
        },
      },
      {
        event: 'content_block_delta',
        data: {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'signature_delta', signature: 'sig123' },
        },
      },
      {
        event: 'content_block_stop',
        data: { type: 'content_block_stop', index: 0 },
      },
      {
        event: 'content_block_start',
        data: {
          type: 'content_block_start',
          index: 1,
          content_block: { type: 'text', text: 'Answer' },
        },
      },
      {
        event: 'content_block_stop',
        data: { type: 'content_block_stop', index: 1 },
      },
      {
        event: 'message_delta',
        data: {
          type: 'message_delta',
          delta: { stop_reason: 'end_turn' },
          usage: { input_tokens: 10, output_tokens: 5 },
        },
      },
      { event: 'message_stop', data: { type: 'message_stop' } },
    ]);
    return new Response(body, {
      headers: { 'Content-Type': 'text/event-stream' },
    });
  });

  try {
    const adapter = new AnthropicAdapter(
      'test-key',
      `http://localhost:${port}`
    );
    const messages: Message[] = [
      { role: 'user', content: [{ type: 'text', text: 'think' }] },
    ];
    const tools: ToolDefinition[] = [
      { name: 'test', description: 'test', inputSchema: {} },
    ];
    const reasoningEvents: string[] = [];

    for await (const event of adapter.messages(
      'claude-3-5-sonnet',
      messages,
      tools
    )) {
      if (event.type === 'reasoning-start')
        reasoningEvents.push(`start:${event.id}`);
      if (event.type === 'reasoning-delta')
        reasoningEvents.push(`delta:${event.text}`);
      if (event.type === 'reasoning-end')
        reasoningEvents.push(`end:${event.id}`);
    }

    expect(reasoningEvents).toContain('start:reasoning-0');
    expect(reasoningEvents).toContain('delta:Let me think');
    expect(reasoningEvents).toContain('delta: about this');
    expect(reasoningEvents).toContain('delta: more');
    expect(reasoningEvents).toContain('end:reasoning-0');
  } finally {
    stopMockServer();
  }
});

// ---------------------------------------------------------------------------
// Test 6: provider-error on 401
// ---------------------------------------------------------------------------

test('Test 6: provider-error on 401', async () => {
  const port = await startMockServer(() => {
    return new Response('Unauthorized', {
      status: 401,
      statusText: 'Unauthorized',
    });
  });

  try {
    const adapter = new AnthropicAdapter('bad-key', `http://localhost:${port}`);
    const messages: Message[] = [
      { role: 'user', content: [{ type: 'text', text: 'hi' }] },
    ];
    let errorMessage = '';
    let errorClassification = '';

    for await (const event of adapter.messages('claude-3-5-sonnet', messages)) {
      if (event.type === 'provider-error') {
        errorMessage = event.message;
        errorClassification = event.classification ?? '';
      }
    }

    expect(errorMessage).toContain('401');
    expect(errorClassification).toEqual('authentication');
  } finally {
    stopMockServer();
  }
});

// ---------------------------------------------------------------------------
// Test 7: provider-error on 429 with classification
// ---------------------------------------------------------------------------

test('Test 7: provider-error on 429 with classification', async () => {
  const port = await startMockServer(() => {
    return new Response('Rate limit exceeded', {
      status: 429,
      statusText: 'Too Many Requests',
    });
  });

  try {
    const adapter = new AnthropicAdapter(
      'test-key',
      `http://localhost:${port}`
    );
    const messages: Message[] = [
      { role: 'user', content: [{ type: 'text', text: 'hi' }] },
    ];
    let errorMessage = '';
    let errorClassification = '';
    let retryable = false;

    for await (const event of adapter.messages('claude-3-5-sonnet', messages)) {
      if (event.type === 'provider-error') {
        errorMessage = event.message;
        errorClassification = event.classification ?? '';
        retryable = event.retryable ?? false;
      }
    }

    expect(errorMessage).toContain('429');
    expect(errorClassification).toEqual('rate-limit');
    expect(retryable).toBe(true);
  } finally {
    stopMockServer();
  }
});

// ---------------------------------------------------------------------------
// Test 8: message with system prompt in body.system field
// ---------------------------------------------------------------------------

test('Test 8: message with system prompt in body.system field', async () => {
  let capturedBody: object | null = null;

  const port = await startMockServer(async (req) => {
    capturedBody = (await req.json()) as object | null;
    const body = makeSSE([
      {
        event: 'message_start',
        data: { type: 'message_start', message: { usage: {} } },
      },
      {
        event: 'content_block_start',
        data: {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text', text: 'Hi' },
        },
      },
      {
        event: 'content_block_stop',
        data: { type: 'content_block_stop', index: 0 },
      },
      {
        event: 'message_delta',
        data: {
          type: 'message_delta',
          delta: { stop_reason: 'end_turn' },
          usage: { input_tokens: 10, output_tokens: 5 },
        },
      },
      { event: 'message_stop', data: { type: 'message_stop' } },
    ]);
    return new Response(body, {
      headers: { 'Content-Type': 'text/event-stream' },
    });
  });

  try {
    const adapter = new AnthropicAdapter(
      'test-key',
      `http://localhost:${port}`
    );
    const messages: Message[] = [
      {
        role: 'system',
        content: [{ type: 'text', text: 'You are a helpful assistant.' }],
      },
      { role: 'user', content: [{ type: 'text', text: 'hi' }] },
    ];

    for await (const _ of adapter.messages('claude-3-5-sonnet', messages)) {
      // consume
    }

    expect(capturedBody).not.toBeNull();
    const body = capturedBody as unknown as Record<string, unknown>;
    expect(body).toHaveProperty('system');
    expect(Array.isArray(body.system)).toBe(true);
    expect((body.system as unknown[]).length).toBeGreaterThan(0);
    expect((body.system as { type: string; text: string }[])[0].type).toEqual(
      'text'
    );
    expect((body.system as { type: string; text: string }[])[0].text).toEqual(
      'You are a helpful assistant.'
    );
  } finally {
    stopMockServer();
  }
});

// ---------------------------------------------------------------------------
// Test 9: empty content block → skipped
// ---------------------------------------------------------------------------

test('Test 9: empty content block → skipped', async () => {
  const port = await startMockServer(() => {
    const body = makeSSE([
      {
        event: 'message_start',
        data: { type: 'message_start', message: { usage: {} } },
      },
      {
        event: 'content_block_start',
        data: {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text', text: '' },
        },
      },
      {
        event: 'content_block_stop',
        data: { type: 'content_block_stop', index: 0 },
      },
      {
        event: 'message_delta',
        data: {
          type: 'message_delta',
          delta: { stop_reason: 'end_turn' },
          usage: { input_tokens: 10, output_tokens: 5 },
        },
      },
      { event: 'message_stop', data: { type: 'message_stop' } },
    ]);
    return new Response(body, {
      headers: { 'Content-Type': 'text/event-stream' },
    });
  });

  try {
    const adapter = new AnthropicAdapter(
      'test-key',
      `http://localhost:${port}`
    );
    const messages: Message[] = [
      { role: 'user', content: [{ type: 'text', text: 'hi' }] },
    ];
    const eventTypes: string[] = [];

    for await (const event of adapter.messages('claude-3-5-sonnet', messages)) {
      eventTypes.push(event.type);
    }

    // Empty text block should not emit text-start
    expect(eventTypes).not.toContain('text-start');
    expect(eventTypes).toContain('finish');
  } finally {
    stopMockServer();
  }
});

// ---------------------------------------------------------------------------
// Test 10: multiple tool calls in one response
// ---------------------------------------------------------------------------

test('Test 10: multiple tool calls in one response', async () => {
  const port = await startMockServer(() => {
    const body = makeSSE([
      {
        event: 'message_start',
        data: { type: 'message_start', message: { usage: {} } },
      },
      {
        event: 'content_block_start',
        data: {
          type: 'content_block_start',
          index: 0,
          content_block: {
            type: 'tool_use',
            id: 'call_1',
            name: 'get_weather',
          },
        },
      },
      {
        event: 'content_block_delta',
        data: {
          type: 'content_block_delta',
          index: 0,
          delta: {
            type: 'input_json_delta',
            partial_json: '{"city": "Seattle"}',
          },
        },
      },
      {
        event: 'content_block_stop',
        data: { type: 'content_block_stop', index: 0 },
      },
      {
        event: 'content_block_start',
        data: {
          type: 'content_block_start',
          index: 1,
          content_block: { type: 'tool_use', id: 'call_2', name: 'get_time' },
        },
      },
      {
        event: 'content_block_delta',
        data: {
          type: 'content_block_delta',
          index: 1,
          delta: { type: 'input_json_delta', partial_json: '{"tz": "PST"}' },
        },
      },
      {
        event: 'content_block_stop',
        data: { type: 'content_block_stop', index: 1 },
      },
      {
        event: 'message_delta',
        data: {
          type: 'message_delta',
          delta: { stop_reason: 'end_turn' },
          usage: { input_tokens: 10, output_tokens: 5 },
        },
      },
      { event: 'message_stop', data: { type: 'message_stop' } },
    ]);
    return new Response(body, {
      headers: { 'Content-Type': 'text/event-stream' },
    });
  });

  try {
    const adapter = new AnthropicAdapter(
      'test-key',
      `http://localhost:${port}`
    );
    const messages: Message[] = [
      { role: 'user', content: [{ type: 'text', text: 'weather and time' }] },
    ];
    const tools: ToolDefinition[] = [
      {
        name: 'get_weather',
        description: 'Get weather',
        inputSchema: { type: 'object' },
      },
      {
        name: 'get_time',
        description: 'Get time',
        inputSchema: { type: 'object' },
      },
    ];
    const toolCalls: { id: string; name: string }[] = [];

    for await (const event of adapter.messages(
      'claude-3-5-sonnet',
      messages,
      tools
    )) {
      if (event.type === 'tool-call') {
        toolCalls.push({ id: event.id, name: event.name });
      }
    }

    expect(toolCalls.length).toBe(2);
    expect(toolCalls[0].id).toEqual('call_1');
    expect(toolCalls[0].name).toEqual('get_weather');
    expect(toolCalls[1].id).toEqual('call_2');
    expect(toolCalls[1].name).toEqual('get_time');
  } finally {
    stopMockServer();
  }
});

// ---------------------------------------------------------------------------
// Test 11: provider-error on 500
// ---------------------------------------------------------------------------

test('Test 11: provider-error on 500 is retryable', async () => {
  const port = await startMockServer(() => {
    return new Response('Internal Server Error', {
      status: 500,
      statusText: 'Internal Server Error',
    });
  });

  try {
    const adapter = new AnthropicAdapter(
      'test-key',
      `http://localhost:${port}`
    );
    const messages: Message[] = [
      { role: 'user', content: [{ type: 'text', text: 'hi' }] },
    ];
    let retryable = false;

    for await (const event of adapter.messages('claude-3-5-sonnet', messages)) {
      if (event.type === 'provider-error') {
        retryable = event.retryable ?? false;
      }
    }

    expect(retryable).toBe(true);
  } finally {
    stopMockServer();
  }
});

// ---------------------------------------------------------------------------
// Test 12: cache tokens in usage (cache_creation_input_tokens, cache_read_input_tokens)
// ---------------------------------------------------------------------------

test('Test 12: cache tokens in usage via message_delta', async () => {
  const port = await startMockServer(() => {
    const body = makeSSE([
      {
        event: 'message_start',
        data: {
          type: 'message_start',
          message: {
            usage: {
              input_tokens: 100,
              cache_creation_input_tokens: 50,
              cache_read_input_tokens: 20,
            },
          },
        },
      },
      {
        event: 'content_block_start',
        data: {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text', text: 'Hi' },
        },
      },
      {
        event: 'content_block_stop',
        data: { type: 'content_block_stop', index: 0 },
      },
      {
        event: 'message_delta',
        data: {
          type: 'message_delta',
          delta: { stop_reason: 'end_turn' },
          usage: {
            input_tokens: 100,
            output_tokens: 5,
            cache_creation_input_tokens: 50,
            cache_read_input_tokens: 20,
          },
        },
      },
      { event: 'message_stop', data: { type: 'message_stop' } },
    ]);
    return new Response(body, {
      headers: { 'Content-Type': 'text/event-stream' },
    });
  });

  try {
    const adapter = new AnthropicAdapter(
      'test-key',
      `http://localhost:${port}`
    );
    const messages: Message[] = [
      { role: 'user', content: [{ type: 'text', text: 'hi' }] },
    ];
    let finishUsage:
      | {
          inputTokens?: number;
          outputTokens?: number;
          cacheCreationInputTokens?: number;
          cacheHitInputTokens?: number;
        }
      | undefined;

    for await (const event of adapter.messages('claude-3-5-sonnet', messages)) {
      if (event.type === 'finish') {
        finishUsage = event.usage;
      }
    }

    expect(finishUsage?.inputTokens).toBe(100);
    expect(finishUsage?.outputTokens).toBe(5);
    expect(finishUsage?.cacheCreationInputTokens).toBe(50);
    expect(finishUsage?.cacheHitInputTokens).toBe(20);
  } finally {
    stopMockServer();
  }
});

// ---------------------------------------------------------------------------
// Test 13: ping event in stream → gracefully skipped
// ---------------------------------------------------------------------------

test('Test 13: ping event in stream → gracefully skipped', async () => {
  const port = await startMockServer(() => {
    const body = makeSSE([
      {
        event: 'message_start',
        data: { type: 'message_start', message: { usage: {} } },
      },
      { event: 'ping', data: { type: 'ping' } },
      {
        event: 'content_block_start',
        data: {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text', text: 'Hi' },
        },
      },
      {
        event: 'content_block_stop',
        data: { type: 'content_block_stop', index: 0 },
      },
      {
        event: 'message_delta',
        data: {
          type: 'message_delta',
          delta: { stop_reason: 'end_turn' },
          usage: { input_tokens: 10, output_tokens: 5 },
        },
      },
      { event: 'message_stop', data: { type: 'message_stop' } },
    ]);
    return new Response(body, {
      headers: { 'Content-Type': 'text/event-stream' },
    });
  });

  try {
    const adapter = new AnthropicAdapter(
      'test-key',
      `http://localhost:${port}`
    );
    const messages: Message[] = [
      { role: 'user', content: [{ type: 'text', text: 'hi' }] },
    ];
    const eventTypes: string[] = [];

    for await (const event of adapter.messages('claude-3-5-sonnet', messages)) {
      eventTypes.push(event.type);
    }

    // ping is not a known LLMEvent type, so it should be skipped (no error thrown)
    expect(eventTypes).toContain('finish');
    expect(eventTypes).not.toContain('error');
  } finally {
    stopMockServer();
  }
});
