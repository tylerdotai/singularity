import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import type { ToolContext } from '../types.js';

const CTX: ToolContext = {
  sessionID: 'test-session',
  agent: 'test-agent',
  assistantMessageID: 'test-msg',
  toolCallID: 'test-call',
};

let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('web_extract tool', () => {
  test('extracts content from HTML page', async () => {
    const { TOOL } = await import('./web-extract.js');
    (globalThis.fetch as unknown) = async () => {
      return new Response(
        '<html><body><h1>Test Page</h1><p>Hello world</p></body></html>',
        {
          status: 200,
          headers: { 'content-type': 'text/html' },
        }
      ) as Response;
    };
    const result = await TOOL.execute(
      { url: 'https://example.com', query: 'the page title' },
      CTX
    );
    expect(result.result.type).toBe('json');
    const val = (result.result as unknown as { type: 'string'; value: unknown })
      .value as {
      url: string;
      query: string;
      extracted: string;
    };
    expect(val.url).toBe('https://example.com');
    expect(val.query).toBe('the page title');
    expect(val.extracted).toContain('Test Page');
  });

  test('returns error for failed fetch', async () => {
    const { TOOL } = await import('./web-extract.js');
    (globalThis.fetch as unknown) = async () => {
      throw new Error('network error');
    };
    const result = await TOOL.execute(
      { url: 'https://example.com', query: 'title' },
      CTX
    );
    expect(result.result.type).toBe('error');
  });

  test('returns error for non-200 status', async () => {
    const { TOOL } = await import('./web-extract.js');
    (globalThis.fetch as unknown) = async () => {
      return new Response('Not Found', { status: 404 });
    };
    const result = await TOOL.execute(
      { url: 'https://example.com/404', query: 'content' },
      CTX
    );
    expect(result.result.type).toBe('error');
  });

  test('handles non-HTML content', async () => {
    const { TOOL } = await import('./web-extract.js');
    (globalThis.fetch as unknown) = async () => {
      return new Response('plain text content', {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      });
    };
    const result = await TOOL.execute(
      { url: 'https://example.com/data.txt', query: 'all text' },
      CTX
    );
    expect(result.result.type).toBe('json');
    const val = (result.result as unknown as { type: 'string'; value: unknown })
      .value as {
      extracted: string;
    };
    expect(val.extracted).toBe('plain text content');
  });

  test('includes extractSchema in response when provided', async () => {
    const { TOOL } = await import('./web-extract.js');
    (globalThis.fetch as unknown) = async () => {
      return new Response('<html><body>test</body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    };
    const schema = { type: 'object', properties: { name: { type: 'string' } } };
    const result = await TOOL.execute(
      { url: 'https://example.com', query: 'name', extractSchema: schema },
      CTX
    );
    expect(result.result.type).toBe('json');
    const val = (result.result as unknown as { type: 'string'; value: unknown })
      .value as {
      schema: Record<string, unknown> | null;
    };
    expect(val.schema).toEqual(schema);
  });

  test('strips script and style tags from HTML', async () => {
    const { TOOL } = await import('./web-extract.js');
    (globalThis.fetch as unknown) = async () => {
      return new Response(
        '<html><head><style>.foo{}</style><script>alert(1)</script></head><body><p>visible</p></body></html>',
        {
          status: 200,
          headers: { 'content-type': 'text/html' },
        }
      );
    };
    const result = await TOOL.execute(
      { url: 'https://example.com', query: 'content' },
      CTX
    );
    expect(result.result.type).toBe('json');
    const val = (result.result as unknown as { type: 'string'; value: unknown })
      .value as {
      extracted: string;
    };
    expect(val.extracted).toContain('visible');
    expect(val.extracted).not.toContain('alert(1)');
    expect(val.extracted).not.toContain('.foo');
  });
});
