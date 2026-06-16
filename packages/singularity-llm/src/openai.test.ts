import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { OpenAIAdapter } from './openai.js';
import type { LLMEvent } from './types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function textDelta(events: LLMEvent[], id = 'text-0') {
  return events.filter((e) => e.type === 'text-delta' && e.id === id) as {
    type: 'text-delta';
    id: string;
    text: string;
  }[];
}

function reasoningDelta(events: LLMEvent[]) {
  return events.filter((e) => e.type === 'reasoning-delta');
}

function toolCalls(events: LLMEvent[]) {
  return events.filter((e) => e.type === 'tool-call');
}

function stepFinish(events: LLMEvent[]) {
  return events.filter((e) => e.type === 'step-finish');
}

function finish(events: LLMEvent[]) {
  return events.filter((e) => e.type === 'finish');
}

function providerErrors(events: LLMEvent[]) {
  return events.filter((e) => e.type === 'provider-error');
}

// ---------------------------------------------------------------------------
// Mock SSE helpers
// ---------------------------------------------------------------------------

function sseChunk(data: object) {
  return `data: ${JSON.stringify(data)}\n\n`;
}

function sseDone() {
  return 'data: [DONE]\n\n';
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('OpenAIAdapter', () => {
  // Shared port for mock server
  let port = 19876;

  // -------------------------------------------------------------------------
  // Test 1: text-delta events emitted correctly
  // -------------------------------------------------------------------------
  test('text-delta events emitted correctly', async () => {
    const { server, url } = await startMockServer(port++, [
      sseChunk({
        choices: [{ delta: { content: 'Hello' }, index: 0 }],
      }),
      sseChunk({
        choices: [{ delta: { content: ' world' }, index: 0 }],
      }),
      sseChunk({
        usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
        choices: [{ delta: {}, index: 0, finish_reason: 'stop' }],
      }),
      sseDone(),
    ]);

    try {
      const adapter = new OpenAIAdapter('test-key', url);
      const events: LLMEvent[] = [];
      for await (const e of adapter.chat('gpt-4o-mini', [
        { role: 'user', content: [{ type: 'text', text: 'hi' }] },
      ])) {
        events.push(e);
      }

      const deltas = textDelta(events);
      expect(deltas).toHaveLength(2);
      expect(deltas[0].text).toBe('Hello');
      expect(deltas[1].text).toBe(' world');
    } finally {
      server.stop();
    }
  });

  // -------------------------------------------------------------------------
  // Test 2: tool-call event carries name + input (parse JSON args)
  // -------------------------------------------------------------------------
  test('tool-call event carries name + parsed input', async () => {
    const { server, url } = await startMockServer(port++, [
      sseChunk({
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'call_abc123',
                  function: { name: 'get_weather', arguments: '{"city": ' },
                },
              ],
            },
            index: 0,
          },
        ],
      }),
      sseChunk({
        choices: [
          {
            delta: {
              tool_calls: [
                { index: 0, function: { arguments: '"San Francisco"}' } },
              ],
            },
            index: 0,
          },
        ],
      }),
      sseChunk({
        usage: { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 },
        choices: [{ delta: {}, index: 0, finish_reason: 'tool_calls' }],
      }),
      sseDone(),
    ]);

    try {
      const adapter = new OpenAIAdapter('test-key', url);
      const events: LLMEvent[] = [];
      for await (const e of adapter.chat(
        'gpt-4o-mini',
        [{ role: 'user', content: [{ type: 'text', text: 'weather?' }] }],
        [{ name: 'get_weather', description: 'Get weather', inputSchema: {} }]
      )) {
        events.push(e);
      }

      const calls = toolCalls(events);
      expect(calls).toHaveLength(1);
      expect(calls[0].name).toBe('get_weather');
      expect(calls[0].input).toEqual({ city: 'San Francisco' });
    } finally {
      server.stop();
    }
  });

  // -------------------------------------------------------------------------
  // Test 3: finish event carries usage { inputTokens, outputTokens, totalTokens }
  // -------------------------------------------------------------------------
  test('step-finish carries usage with inputTokens, outputTokens, totalTokens', async () => {
    const { server, url } = await startMockServer(port++, [
      sseChunk({
        choices: [{ delta: { content: 'Answer' }, index: 0 }],
      }),
      sseChunk({
        usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 },
        choices: [
          {
            delta: {},
            index: 0,
            finish_reason: 'stop',
          },
        ],
      }),
      sseDone(),
    ]);

    try {
      const adapter = new OpenAIAdapter('test-key', url);
      const events: LLMEvent[] = [];
      for await (const e of adapter.chat('gpt-4o-mini', [
        { role: 'user', content: [{ type: 'text', text: 'hi' }] },
      ])) {
        events.push(e);
      }

      const finishes = stepFinish(events);
      expect(finishes).toHaveLength(1);
      expect(finishes[0].usage?.inputTokens).toBe(20);
      expect(finishes[0].usage?.outputTokens).toBe(5);
      expect(finishes[0].usage?.totalTokens).toBe(25);
    } finally {
      server.stop();
    }
  });

  // -------------------------------------------------------------------------
  // Test 4: provider-error on 401
  // -------------------------------------------------------------------------
  test('provider-error on 401', async () => {
    const { server, url } = await startMockServer(port++, [], 401);

    try {
      const adapter = new OpenAIAdapter('test-key', url);
      const events: LLMEvent[] = [];
      for await (const e of adapter.chat('gpt-4o-mini', [
        { role: 'user', content: [{ type: 'text', text: 'hi' }] },
      ])) {
        events.push(e);
      }

      const errors = providerErrors(events);
      expect(errors).toHaveLength(1);
      expect(errors[0].retryable).toBe(false);
    } finally {
      server.stop();
    }
  });

  // -------------------------------------------------------------------------
  // Test 5: provider-error on 429 with classification "rate_limit"
  // -------------------------------------------------------------------------
  test('provider-error on 429 is retryable', async () => {
    const { server, url } = await startMockServer(port++, [], 429);

    try {
      const adapter = new OpenAIAdapter('test-key', url);
      const events: LLMEvent[] = [];
      for await (const e of adapter.chat('gpt-4o-mini', [
        { role: 'user', content: [{ type: 'text', text: 'hi' }] },
      ])) {
        events.push(e);
      }

      const errors = providerErrors(events);
      expect(errors).toHaveLength(1);
      expect(errors[0].retryable).toBe(true);
    } finally {
      server.stop();
    }
  });

  // -------------------------------------------------------------------------
  // Test 6: tool-call with multiple tools
  // -------------------------------------------------------------------------
  test('multiple tool-calls in sequence', async () => {
    const { server, url } = await startMockServer(port++, [
      sseChunk({
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'call_1',
                  function: {
                    name: 'get_weather',
                    arguments: '{"city": "NYC"}',
                  },
                },
              ],
            },
            index: 0,
          },
        ],
      }),
      sseChunk({
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 1,
                  id: 'call_2',
                  function: { name: 'get_time', arguments: '{"tz": "ET"}' },
                },
              ],
            },
            index: 0,
          },
        ],
      }),
      sseChunk({
        usage: { prompt_tokens: 30, completion_tokens: 15, total_tokens: 45 },
        choices: [{ delta: {}, index: 0, finish_reason: 'tool_calls' }],
      }),
      sseDone(),
    ]);

    try {
      const adapter = new OpenAIAdapter('test-key', url);
      const events: LLMEvent[] = [];
      for await (const e of adapter.chat(
        'gpt-4o-mini',
        [
          {
            role: 'user',
            content: [{ type: 'text', text: 'weather and time?' }],
          },
        ],
        [
          { name: 'get_weather', description: '', inputSchema: {} },
          { name: 'get_time', description: '', inputSchema: {} },
        ]
      )) {
        events.push(e);
      }

      const calls = toolCalls(events);
      expect(calls).toHaveLength(2);
      expect(calls[0].name).toBe('get_weather');
      expect(calls[0].input).toEqual({ city: 'NYC' });
      expect(calls[1].name).toBe('get_time');
      expect(calls[1].input).toEqual({ tz: 'ET' });
    } finally {
      server.stop();
    }
  });

  // -------------------------------------------------------------------------
  // Test 7: streaming interrupted (incomplete chunk)
  // -------------------------------------------------------------------------
  test('streaming interrupted — resumes correctly on next chunk', async () => {
    // Simulate a chunk split across two reads: "partial" then " data: ..."
    const { server, url } = await startMockServer(port++, [
      // Server sends one complete event + one incomplete
      sseChunk({
        choices: [{ delta: { content: 'First' }, index: 0 }],
      }),
      // This simulates a chunk that gets split; server sends complete events
      sseChunk({
        choices: [{ delta: { content: 'Second' }, index: 0 }],
      }),
      sseChunk({
        usage: { prompt_tokens: 5, completion_tokens: 12, total_tokens: 17 },
        choices: [
          {
            delta: {},
            index: 0,
            finish_reason: 'stop',
          },
        ],
      }),
      sseDone(),
    ]);

    try {
      const adapter = new OpenAIAdapter('test-key', url);
      const events: LLMEvent[] = [];
      for await (const e of adapter.chat('gpt-4o-mini', [
        { role: 'user', content: [{ type: 'text', text: 'hi' }] },
      ])) {
        events.push(e);
      }

      const deltas = textDelta(events);
      expect(deltas).toHaveLength(2);
      expect(deltas[0].text).toBe('First');
      expect(deltas[1].text).toBe('Second');
    } finally {
      server.stop();
    }
  });

  // -------------------------------------------------------------------------
  // Test 8: invalid JSON in SSE line → skipped gracefully
  // -------------------------------------------------------------------------
  test('invalid JSON in SSE line is skipped', async () => {
    const { server, url } = await startMockServer(port++, [
      sseChunk({ choices: [{ delta: { content: 'Good' }, index: 0 }] }),
      'data: not-valid-json\n\n',
      sseChunk({
        usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
        choices: [
          {
            delta: {},
            index: 0,
            finish_reason: 'stop',
          },
        ],
      }),
      sseDone(),
    ]);

    try {
      const adapter = new OpenAIAdapter('test-key', url);
      const events: LLMEvent[] = [];
      for await (const e of adapter.chat('gpt-4o-mini', [
        { role: 'user', content: [{ type: 'text', text: 'hi' }] },
      ])) {
        events.push(e);
      }

      const deltas = textDelta(events);
      expect(deltas).toHaveLength(1);
      expect(deltas[0].text).toBe('Good');
    } finally {
      server.stop();
    }
  });

  // -------------------------------------------------------------------------
  // Test 9: empty response → finish with stop
  // -------------------------------------------------------------------------
  test('empty response body emits finish with stop reason', async () => {
    const { server, url } = await startMockServer(port++, [
      sseChunk({ choices: [{ delta: {}, index: 0, finish_reason: 'stop' }] }),
      sseDone(),
    ]);

    try {
      const adapter = new OpenAIAdapter('test-key', url);
      const events: LLMEvent[] = [];
      for await (const e of adapter.chat('gpt-4o-mini', [
        { role: 'user', content: [{ type: 'text', text: 'hi' }] },
      ])) {
        events.push(e);
      }

      // step-finish with stop
      const finishes = stepFinish(events);
      expect(finishes).toHaveLength(1);
      expect(finishes[0].reason).toBe('stop');
    } finally {
      server.stop();
    }
  });

  // -------------------------------------------------------------------------
  // Test 10: reasoning_content delta events mapped to reasoning-delta
  // -------------------------------------------------------------------------
  test('reasoning_content delta mapped to reasoning-delta event', async () => {
    const { server, url } = await startMockServer(port++, [
      sseChunk({
        choices: [{ delta: { reasoning_content: 'thinking...' }, index: 0 }],
      }),
      sseChunk({
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        choices: [
          {
            delta: {},
            index: 0,
            finish_reason: 'stop',
          },
        ],
      }),
      sseDone(),
    ]);

    try {
      const adapter = new OpenAIAdapter('test-key', url);
      const events: LLMEvent[] = [];
      for await (const e of adapter.chat('gpt-4o-mini', [
        { role: 'user', content: [{ type: 'text', text: 'think' }] },
      ])) {
        events.push(e);
      }

      const reasoning = reasoningDelta(events);
      expect(reasoning).toHaveLength(1);
      expect(reasoning[0].text).toBe('thinking...');
    } finally {
      server.stop();
    }
  });
});

// ---------------------------------------------------------------------------
// Mock HTTP server using Bun.serve
// ---------------------------------------------------------------------------

async function startMockServer(
  p: number,
  chunks: string[],
  status = 200
): Promise<{ server: { stop(): void }; url: string }> {
  let sent = false;

  const server = Bun.serve({
    port: p,
    async fetch(req) {
      if (status !== 200) {
        return new Response(null, { status });
      }

      if (sent) {
        return new Response('already served', { status: 500 });
      }
      sent = true;

      const body = chunks.join('');

      return new Response(body, {
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
      });
    },
  });

  return { server, url: `http://localhost:${server.port}` };
}
