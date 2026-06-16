import type {
  FinishReason,
  GenerationOptions,
  LLMEvent,
  Message,
  ToolDefinition,
  Usage,
} from './types.js';

const DEFAULT_BASE_URL = 'https://api.minimax.io/v1';

export interface MiniMaxChatOptions {
  tools?: ReadonlyArray<ToolDefinition>;
  generation?: GenerationOptions;
  reasoningSplit?: boolean;
}

export class MiniMaxAdapter {
  readonly provider = 'minimax' as const;
  readonly model: string;

  constructor(
    private apiKey: string,
    private baseURL: string = DEFAULT_BASE_URL,
    model = 'MiniMax-M3'
  ) {
    this.model = model;
  }

  async *chat(
    messages: ReadonlyArray<Message>,
    options?: MiniMaxChatOptions
  ): AsyncGenerator<LLMEvent> {
    const tools = options?.tools;
    const reasoningSplit = options?.reasoningSplit ?? false;

    const body: Record<string, unknown> = {
      model: this.model,
      messages: messages.map((m) => ({
        role: m.role,
        content: extractText(m.content),
      })),
      stream: true,
      stream_options: { include_usage: true },
    };

    if (tools?.length) {
      body.tools = tools.map((t) => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.inputSchema,
        },
      }));
    }

    if (reasoningSplit) {
      body.extra_body = { reasoning_split: true };
    }

    if (options?.generation) {
      if (options.generation.maxTokens)
        body.max_tokens = options.generation.maxTokens;
      if (options.generation.temperature)
        body.temperature = options.generation.temperature;
      if (options.generation.topP) body.top_p = options.generation.topP;
    }

    const url = `${this.baseURL}/chat/completions`;
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      yield {
        type: 'provider-error',
        message: `Network error: ${String(err)}`,
        retryable: true,
      } satisfies LLMEvent;
      return;
    }

    if (!response.ok) {
      yield {
        type: 'provider-error',
        message: `HTTP ${response.status}`,
        retryable: response.status === 429 || response.status >= 500,
      } satisfies LLMEvent;
      return;
    }

    if (!response.body) {
      yield {
        type: 'provider-error',
        message: 'Empty response body',
        retryable: false,
      } satisfies LLMEvent;
      return;
    }

    const toolCalls = new Map<
      number,
      { id?: string; name?: string; argumentsText: string }
    >();
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
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const data = trimmed.slice(5).trim();
          if (data === '[DONE]') continue;

          let chunk: MiniMaxChunk;
          try {
            chunk = JSON.parse(data) as MiniMaxChunk;
          } catch {
            continue;
          }

          // MiniMax API-level error
          if (chunk.base_resp && chunk.base_resp.status_code !== 0) {
            yield {
              type: 'provider-error',
              message:
                chunk.base_resp.status_msg ??
                `MiniMax error ${chunk.base_resp.status_code}`,
              retryable: false,
            } satisfies LLMEvent;
            continue;
          }

          const choice = chunk.choices?.[0];
          const delta = choice?.delta;

          // text-delta
          if (delta?.content) {
            yield {
              type: 'text-delta',
              id: chunk.id ?? 'chatcmpl',
              text: delta.content,
            } satisfies LLMEvent;
          }

          // reasoning_content delta (when reasoning_split: true)
          if (delta?.reasoning_content) {
            yield {
              type: 'reasoning-delta',
              id: 'reasoning-0',
              text: delta.reasoning_content,
            } satisfies LLMEvent;
          }

          // tool-call deltas
          if (delta?.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index;
              const existing = toolCalls.get(idx) ?? {
                id: undefined,
                name: undefined,
                argumentsText: '',
              };
              if (tc.id !== undefined && tc.id !== null) existing.id = tc.id;
              if (tc.function?.name !== undefined && tc.function?.name !== null)
                existing.name = tc.function.name;
              if (
                tc.function?.arguments !== undefined &&
                tc.function?.arguments !== null
              )
                existing.argumentsText += tc.function.arguments;
              toolCalls.set(idx, existing);
            }
          }

          // finish_reason
          if (choice?.finish_reason) {
            if (toolCalls.size > 0) {
              const sorted = [...toolCalls.entries()].sort(([a], [b]) => a - b);
              for (const [, tc] of sorted) {
                if (tc.name) {
                  yield {
                    type: 'tool-call',
                    id: tc.id ?? '',
                    name: tc.name,
                    input: safeParseJSON(tc.argumentsText),
                  } satisfies LLMEvent;
                }
              }
              toolCalls.clear();
            }

            const usage: Usage | undefined = chunk.usage
              ? {
                  inputTokens: chunk.usage.prompt_tokens ?? 0,
                  outputTokens: chunk.usage.completion_tokens ?? 0,
                  totalTokens: chunk.usage.total_tokens ?? 0,
                  cacheHitInputTokens:
                    chunk.usage.prompt_tokens_details?.cached_tokens,
                }
              : undefined;

            yield {
              type: 'step-finish',
              index: 0,
              reason: mapFinishReason(choice.finish_reason),
              usage,
            } satisfies LLMEvent;
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    yield {
      type: 'finish',
      reason: 'stop',
      usage: undefined,
    } satisfies LLMEvent;
  }
}

function extractText(
  content: ReadonlyArray<{ type: string; text?: string }>
): string {
  return content
    .filter((p) => p.type === 'text')
    .map((p) => p.text ?? '')
    .join('');
}

function safeParseJSON(text: string): unknown {
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function mapFinishReason(reason: string | null | undefined): FinishReason {
  if (reason === 'stop') return 'stop';
  if (reason === 'length') return 'length';
  if (reason === 'tool_calls') return 'tool_calls';
  if (reason === 'content_filter') return 'content_filter';
  return 'stop';
}

interface MiniMaxChunk {
  id?: string;
  choices?: Array<{
    index?: number;
    delta?: {
      content?: string | null;
      reasoning_content?: string | null;
      tool_calls?: Array<{
        index: number;
        id?: string | null;
        function?: {
          name?: string | null;
          arguments?: string | null;
        };
      }>;
    };
    finish_reason?: string | null;
  }>;
  usage?: {
    total_tokens?: number;
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: {
      cached_tokens?: number;
    };
  };
  input_sensitive?: boolean;
  output_sensitive?: boolean;
  base_resp?: {
    status_code?: number;
    status_msg?: string;
  };
}

// ---------------------------------------------------------------------------
// Factory + key getter for router integration
// ---------------------------------------------------------------------------

export interface MiniMaxCreateOptions {
  apiKey?: string;
  baseURL?: string;
  model?: string;
  reasoningSplit?: boolean;
}

export function createMiniMaxAdapter(
  options?: MiniMaxCreateOptions
): MiniMaxAdapter {
  const key = options?.apiKey ?? (process as any).env.MINIMAX_API_KEY ?? '';
  return new MiniMaxAdapter(key, options?.baseURL, options?.model);
}
