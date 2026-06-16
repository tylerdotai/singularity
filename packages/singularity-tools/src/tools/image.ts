import { ToolValidationError } from '../errors.js';
import { makeTool, type ToolInstance } from '../registry.js';
import type { ToolContext } from '../types.js';

const TOOL: ToolInstance = makeTool({
  name: 'image_generate',
  description: 'Generate an image from a text prompt using DALL-E or similar',
  riskScore: 'LOW',
  subsystem: ['vision'],
  inputSchema: {
    type: 'object',
    properties: {
      prompt: {
        type: 'string',
        description: 'Text prompt describing the image to generate',
      },
      size: {
        type: 'string',
        optional: true,
        enum: ['256x256', '512x512', '1024x1024'],
        description: 'Image size (default: 1024x1024)',
      },
    },
    required: ['prompt'],
  },
  async execute(input: unknown, _context: ToolContext) {
    const { prompt, size = '1024x1024' } = input as {
      prompt: string;
      size?: '256x256' | '512x512' | '1024x1024';
    };

    if (!prompt || typeof prompt !== 'string') {
      throw new ToolValidationError('prompt is required and must be a string');
    }

    if (prompt.length < 1) {
      throw new ToolValidationError('prompt cannot be empty');
    }

    try {
      // Placeholder implementation - calls OpenAI DALL-E or similar
      // In production this would call the actual image generation API
      const revisedPrompt = prompt;

      return {
        result: {
          type: 'json',
          value: {
            url: `https://placeholder.example.com/generated/${Date.now()}.png`,
            revisedPrompt,
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
