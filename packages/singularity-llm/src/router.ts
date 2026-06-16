// Provider router for singularity-llm
// Factory + router: routes model names to adapters and creates configured instances

import { ProviderError } from './errors.js';
import { createMiniMaxAdapter } from './minimax.js';
import type { GenerationOptions, Usage } from './types.js';

// ---------- Adapter type ----------

export type LLMAdapter = {
  readonly provider: 'openai' | 'minimax' | 'anthropic';
  readonly model: string;
  chat(
    messages: ReadonlyArray<{
      role: string;
      content: ReadonlyArray<unknown>;
    }>,
    options?: {
      tools?: ReadonlyArray<unknown>;
      toolChoice?: unknown;
      generation?: unknown;
      providerOptions?: unknown;
      cache?: unknown;
    }
  ): AsyncGenerator<{
    type: string;
    [key: string]: unknown;
  }>;
};

// ---------- Environment variable reading ----------

export function getApiKey(
  provider: 'openai' | 'minimax' | 'anthropic'
): string | undefined {
  const env = (
    process as unknown as { env: Record<string, string | undefined> }
  ).env;
  if (provider === 'openai') return env.OPENAI_API_KEY;
  if (provider === 'minimax') return env.MINIMAX_API_KEY;
  if (provider === 'anthropic') return env.ANTHROPIC_API_KEY;
  return undefined;
}

// ---------- Model routing ----------

export function routeModel(model: string): 'openai' | 'minimax' | 'anthropic' {
  if (
    model.startsWith('gpt-') ||
    model.startsWith('o1-') ||
    model.startsWith('o3-')
  )
    return 'openai';
  if (model.startsWith('MiniMax-')) return 'minimax';
  if (model.startsWith('claude-')) return 'anthropic';
  return model.includes('claude') ? 'anthropic' : 'openai';
}

// ---------- Factory ----------

export interface CreateLLMOptions {
  openAIKey?: string;
  minimaxKey?: string;
  anthropicKey?: string;
  openAIBaseURL?: string;
  minimaxBaseURL?: string;
  anthropicBaseURL?: string;
}

/**
 * Factory: creates a configured adapter based on env var availability.
 * Prefer OpenAI if both available.
 */
export function createLLM(options?: CreateLLMOptions): LLMAdapter {
  const openAIKey = options?.openAIKey ?? getApiKey('openai');
  const minimaxKey = options?.minimaxKey ?? getApiKey('minimax');
  const anthropicKey = options?.anthropicKey ?? getApiKey('anthropic');

  if (openAIKey) {
    return createOpenAIAdapter(openAIKey, options?.openAIBaseURL);
  }

  if (minimaxKey) {
    return createMinimaxAdapter(minimaxKey, options?.minimaxBaseURL);
  }

  if (anthropicKey) {
    return createAnthropicAdapter(anthropicKey, options?.anthropicBaseURL);
  }

  return createOpenAIAdapter(openAIKey ?? '', options?.openAIBaseURL);
}

function createOpenAIAdapter(apiKey: string, baseURL?: string): LLMAdapter {
  return new OpenAIAdapterImpl(apiKey, baseURL);
}

function createAnthropicAdapter(apiKey: string, baseURL?: string): LLMAdapter {
  return new AnthropicAdapterImpl(apiKey, baseURL);
}

function createMinimaxAdapter(apiKey: string, baseURL?: string): LLMAdapter {
  return createMiniMaxAdapter({ apiKey, baseURL });
}

// ---------- Adapter implementations ----------

class OpenAIAdapterImpl implements LLMAdapter {
  readonly provider = 'openai' as const;
  readonly model: string;

  constructor(
    private readonly apiKey: string,
    private readonly baseURL?: string
  ) {
    this.model = 'gpt-4o';
  }

  async *chat(
    messages: ReadonlyArray<{ role: string; content: ReadonlyArray<unknown> }>,
    options?: {
      tools?: ReadonlyArray<unknown>;
      toolChoice?: unknown;
      generation?: GenerationOptions;
      providerOptions?: unknown;
      cache?: unknown;
    }
  ): AsyncGenerator<{ type: string; [key: string]: unknown }> {
    const url = this.baseURL ?? 'https://api.openai.com/v1/chat/completions';
    const body: Record<string, unknown> = {
      model: this.model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      stream: true,
    };
    if (options?.tools?.length) body.tools = options.tools;
    if (options?.toolChoice) body.tool_choice = options.toolChoice;
    if (options?.generation) {
      if (options.generation.maxTokens)
        body.max_tokens = options.generation.maxTokens;
      if (options.generation.temperature)
        body.temperature = options.generation.temperature;
      if (options.generation.topP) body.top_p = options.generation.topP;
      if (options.generation.stop) body.stop = options.generation.stop;
    }
    if (options?.cache) body.cache = options.cache;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new ProviderError(
        `OpenAI error: ${response.status} ${error}`,
        String(response.status),
        response.status === 429 || response.status >= 500
      );
    }

    if (!response.body) {
      throw new ProviderError('OpenAI: empty response body', 'empty', false);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') {
              yield { type: 'finish', reason: 'stop' as const };
              continue;
            }
            try {
              const parsed = JSON.parse(data);
              if (parsed.choices?.[0]?.delta?.content) {
                yield {
                  type: 'text-delta',
                  id: String(parsed.id ?? ''),
                  text: parsed.choices[0].delta.content,
                };
              }
              if (parsed.choices?.[0]?.finish_reason) {
                yield {
                  type: 'finish',
                  reason: parsed.choices[0].finish_reason,
                  usage: parsed.usage,
                };
              }
            } catch {
              // Skip malformed JSON
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}

class AnthropicAdapterImpl implements LLMAdapter {
  readonly provider = 'anthropic' as const;
  readonly model: string;

  constructor(
    private readonly apiKey: string,
    private readonly baseURL?: string
  ) {
    this.model = 'claude-3-5-sonnet';
  }

  async *chat(
    messages: ReadonlyArray<{ role: string; content: ReadonlyArray<unknown> }>,
    options?: {
      tools?: ReadonlyArray<unknown>;
      toolChoice?: unknown;
      generation?: GenerationOptions;
      providerOptions?: unknown;
      cache?: unknown;
    }
  ): AsyncGenerator<{ type: string; [key: string]: unknown }> {
    const url = this.baseURL ?? 'https://api.anthropic.com/v1/messages';
    const body: Record<string, unknown> = {
      model: this.model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      stream: true,
    };
    if (options?.tools?.length) body.tools = options.tools;
    if (options?.generation) {
      if (options.generation.maxTokens)
        body.max_tokens = options.generation.maxTokens;
      if (options.generation.temperature)
        body.temperature = options.generation.temperature;
      if (options.generation.topP) body.top_p = options.generation.topP;
      if (options.generation.stop) body.stop = options.generation.stop;
    }
    if (options?.cache) body.cache = options.cache;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new ProviderError(
        `Anthropic error: ${response.status} ${error}`,
        String(response.status),
        response.status === 429 || response.status >= 500
      );
    }

    if (!response.body) {
      throw new ProviderError('Anthropic: empty response body', 'empty', false);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') {
              yield { type: 'finish', reason: 'stop' as const };
              continue;
            }
            try {
              const parsed = JSON.parse(data);
              if (parsed.type === 'content_block_delta') {
                if (parsed.delta?.type === 'text_delta') {
                  yield {
                    type: 'text-delta',
                    id: String(parsed.index ?? ''),
                    text: parsed.delta.text,
                  };
                }
              }
              if (parsed.type === 'message_delta') {
                yield {
                  type: 'finish',
                  reason: parsed.delta?.stop_reason ?? 'stop',
                  usage: parsed.usage,
                };
              }
            } catch {
              // Skip malformed JSON
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}
