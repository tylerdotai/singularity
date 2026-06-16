import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import type { ToolContext } from '../types.js';

const CTX: ToolContext = {
  sessionID: 'test-session',
  agent: 'test-agent',
  assistantMessageID: 'test-msg',
  toolCallID: 'test-call',
};

// Save/restore global fetch to prevent test pollution
let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('webfetch tool', () => {
  test('fetches a real URL and returns status + body', async () => {
    const { TOOL } = await import('./webfetch.js');
    (globalThis.fetch as unknown) = async (url: unknown, init?: unknown) => {
      const urlStr =
        typeof url === 'string'
          ? url
          : url instanceof URL
            ? url.href
            : ((url as { url?: string }).url ?? '');
      if (urlStr.includes('/test')) {
        return new Response('hello world', {
          status: 200,
          headers: { 'content-type': 'text/plain' },
        });
      }
      return new Response('not found', { status: 404 });
    };
    const result = await TOOL.execute({ url: 'http://example.com/test' }, CTX);
    expect(result.result.type).toBe('json');
    const val = (result.result as unknown as { type: 'string'; value: unknown })
      .value as {
      status: number;
      body: string;
    };
    expect(val.status).toBe(200);
    expect(val.body).toBe('hello world');
  });

  test('returns truncated flag for large bodies', async () => {
    const { TOOL } = await import('./webfetch.js');
    const bigBody = 'x'.repeat(2_000_000);
    (globalThis.fetch as unknown) = async () => new Response(bigBody);
    const result = await TOOL.execute({ url: 'http://example.com/big' }, CTX);
    expect(result.result.type).toBe('json');
    const val = (result.result as unknown as { type: 'string'; value: unknown })
      .value as {
      truncated: boolean;
      body: string;
    };
    expect(val.truncated).toBe(true);
    expect(val.body.length).toBe(1_000_000);
  });

  test('returns error on network failure', async () => {
    const { TOOL } = await import('./webfetch.js');
    (globalThis.fetch as unknown) = async () => {
      throw new Error('network error');
    };
    const result = await TOOL.execute({ url: 'http://example.com/fail' }, CTX);
    expect(result.result.type).toBe('error');
  });

  test('uses POST method when body is provided', async () => {
    const { TOOL } = await import('./webfetch.js');
    let receivedMethod = '';
    let receivedBody = '';
    (globalThis.fetch as unknown) = async (url: unknown, init?: unknown) => {
      receivedMethod = (init as { method?: string })?.method ?? 'GET';
      receivedBody = ((init as { body?: string })?.body as string) ?? '';
      return new Response('ok');
    };
    await TOOL.execute(
      { url: 'http://example.com/post', method: 'POST', body: 'request-body' },
      CTX
    );
    expect(receivedMethod).toBe('POST');
    expect(receivedBody).toBe('request-body');
  });

  test('returns response headers', async () => {
    const { TOOL } = await import('./webfetch.js');
    (globalThis.fetch as unknown) = async () =>
      new Response('ok', {
        headers: {
          'x-custom': 'header-value',
          'content-type': 'application/json',
        },
      });
    const result = await TOOL.execute(
      { url: 'http://example.com/headers' },
      CTX
    );
    expect(result.result.type).toBe('json');
    const val = (result.result as unknown as { type: 'string'; value: unknown })
      .value as {
      headers: Record<string, string>;
    };
    expect(val.headers['x-custom']).toBe('header-value');
  });
});
