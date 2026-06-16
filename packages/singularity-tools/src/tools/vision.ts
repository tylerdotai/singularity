import { ToolValidationError } from '../errors.js';
import { makeTool, type ToolInstance } from '../registry.js';
import type { ToolContext } from '../types.js';

const TOOL: ToolInstance = makeTool({
  name: 'vision_analyze',
  description:
    'Analyze an image and return a description with tags and confidence score',
  riskScore: 'LOW',
  subsystem: ['vision'],
  inputSchema: {
    type: 'object',
    properties: {
      imageUrl: { type: 'string', description: 'URL of the image to analyze' },
      prompt: {
        type: 'string',
        optional: true,
        description: 'Optional prompt to guide the analysis',
      },
    },
    required: ['imageUrl'],
  },
  async execute(input: unknown, _context: ToolContext) {
    const { imageUrl, prompt } = input as { imageUrl: string; prompt?: string };

    if (!imageUrl || typeof imageUrl !== 'string') {
      throw new ToolValidationError(
        'imageUrl is required and must be a string'
      );
    }

    // Basic URL validation
    try {
      new URL(imageUrl);
    } catch {
      throw new ToolValidationError('imageUrl must be a valid URL');
    }

    try {
      // Placeholder implementation - calls vision service
      // In production this would call OpenAI vision API or similar
      const description = prompt
        ? `Analysis guided by: ${prompt}`
        : 'Image analysis description';

      const tags = ['object', 'scene', 'visual-content'];

      return {
        result: {
          type: 'json',
          value: {
            description,
            tags,
            confidence: 0.85,
          },
        },
      };
    } catch (err) {
      return { result: { type: 'error', value: String(err) } };
    }
  },
});

export { TOOL };
export default TOOL;
