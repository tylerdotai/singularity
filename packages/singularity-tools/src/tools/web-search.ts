import { makeTool, type ToolInstance } from '../registry.js';
import type { ToolContext } from '../types.js';

// SearXNG instance URL - can be overridden via SEARXNG_URL env var
const SEARXNG_URL = process.env.SEARXNG_URL ?? 'http://localhost:8888';

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

interface SearXNGResult {
  title: string;
  url: string;
  content: string;
}

const TOOL: ToolInstance = makeTool({
  name: 'web_search',
  description: 'Search the web using SearXNG meta-search engine',
  riskScore: 'LOW',
  subsystem: ['web'],
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query', minLength: 1 },
      numResults: {
        type: 'number',
        optional: true,
        description: 'Number of results to return (default: 10)',
        minimum: 1,
        maximum: 50,
      },
    },
    required: ['query'],
  },
  async execute(input: unknown, _context: ToolContext) {
    const { query, numResults = 10 } = input as {
      query: string;
      numResults?: number;
    };
    try {
      const searchUrl = new URL(`${SEARXNG_URL}/search`);
      searchUrl.searchParams.set('q', query);
      searchUrl.searchParams.set('format', 'json');
      searchUrl.searchParams.set('engines', 'google,bing,duckduckgo');
      searchUrl.searchParams.set('limit', String(numResults));

      const response = await fetch(searchUrl.toString(), {
        signal: AbortSignal.timeout(15_000),
      });

      if (!response.ok) {
        return {
          result: {
            type: 'error',
            value: `SearXNG returned ${response.status}: ${response.statusText}`,
          },
        };
      }

      const data = (await response.json()) as { results?: SearXNGResult[] };

      if (!data.results || !Array.isArray(data.results)) {
        return {
          result: {
            type: 'error',
            value: 'Invalid response from SearXNG',
          },
        };
      }

      const results: SearchResult[] = data.results
        .slice(0, numResults)
        .map((r) => ({
          title: r.title ?? '',
          url: r.url ?? '',
          snippet: r.content ?? '',
        }));

      return {
        result: {
          type: 'json',
          value: { results },
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        result: {
          type: 'error',
          value: `Web search failed: ${message}`,
        },
      };
    }
  },
});

export { TOOL };
export default TOOL;
