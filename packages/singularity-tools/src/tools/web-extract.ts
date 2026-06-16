import { makeTool, type ToolInstance } from '../registry.js';
import type { ToolContext } from '../types.js';

const TOOL: ToolInstance = makeTool({
  name: 'web_extract',
  description:
    'Extract structured data from a web page given a URL and natural-language query. Fetches the page and extracts relevant information.',
  riskScore: 'LOW',
  approvalRequired: false,
  subsystem: ['web', 'extraction'],
  inputSchema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'URL to fetch and extract from' },
      query: {
        type: 'string',
        description:
          "Natural-language query describing what data to extract (e.g. 'all product names and prices', 'the article title and author')",
      },
      extractSchema: {
        type: 'object',
        description:
          'Optional JSON schema describing the structure of data to extract. If not provided, returns plain text.',
        optional: true,
      },
    },
    required: ['url', 'query'],
  },
  async execute(input: unknown, _context: ToolContext) {
    const { url, query, extractSchema } = input as {
      url: string;
      query: string;
      extractSchema?: Record<string, unknown>;
    };

    try {
      const response = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
      });

      if (!response.ok) {
        return {
          result: {
            type: 'error',
            value: `HTTP ${response.status}: ${response.statusText}`,
          },
        };
      }

      const contentType = response.headers.get('content-type') ?? '';
      const isHtml = contentType.includes('text/html');

      // For HTML pages, perform basic content extraction
      // In Phase 6 this would use a proper HTML parser with query understanding
      if (isHtml) {
        const text = await response.text();
        // Simple extraction: find text around keywords from query
        // This is a stub - real implementation would use AI or DOM parsing
        const extracted = extractTextContent(text, query);
        return {
          result: {
            type: 'json',
            value: {
              url,
              query,
              extracted,
              schema: extractSchema ?? null,
              contentType,
            },
          },
        };
      }

      // For non-HTML, return the raw content
      const text = await response.text();
      return {
        result: {
          type: 'json',
          value: {
            url,
            query,
            extracted: text,
            schema: extractSchema ?? null,
            contentType,
          },
        },
      };
    } catch (err) {
      return {
        result: {
          type: 'error',
          value: `Failed to fetch ${url}: ${String(err)}`,
        },
      };
    }
  },
});

/**
 * Simple text content extraction based on query keywords.
 * This is a stub implementation - a real version would use AI or proper DOM parsing.
 */
function extractTextContent(html: string, query: string): string {
  // Strip HTML tags for plain text extraction
  const textOnly = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // For now, return the first 2000 characters as a simple extraction
  // A real implementation would understand the query and extract relevant sections
  const snippet = textOnly.slice(0, 2000);
  return snippet;
}

export { TOOL };
export default TOOL;
