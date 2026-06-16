import type {
  FinishReason,
  LLMEvent,
  Message,
  ToolDefinition,
  Usage,
} from './types.js';

// ---------------------------------------------------------------------------
// OpenAIAdapter
// ---------------------------------------------------------------------------

export class OpenAIAdapter {
  constructor(
    private apiKey: string,
    private baseURL = 'https://api.openai.com/v1'
  ) {}

  // ---------------------------------------------------------------------------
  // chat
  // ---------------------------------------------------------------------------

  async *chat(
    model: string,
    messages: ReadonlyArray<Message>,
    tools?: ReadonlyArray<ToolDefinition>
  ): AsyncGenerator<LLMEvent> {
    const body = buildBody(model, messages, tools);

    let response: Response;
    try {
      response = await fetch(`${this.baseURL}/chat/completions`, {
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
        message: String(err),
        retryable: true,
      } satisfies LLMEvent;
      return;
    }

    if (!response.ok) {
      const retryable = response.status === 429 || response.status >= 500;
      yield {
        type: 'provider-error',
        message: response.statusText,
        retryable,
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

    // tool-call accumulator: index -> { id?, name?, argumentsText }
    const toolCalls: Map<
      number,
      { id?: string; name?: string; argumentsText: string }
    > = new Map();

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        // keep unterminated line in buffer
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const event = parseSSELine(line);
          if (!event) continue;

          const choice = event.choices?.[0];
          const delta = choice?.delta;

          // text-delta
          if (delta?.content) {
            yield {
              type: 'text-delta',
              id: 'text-0',
              text: delta.content,
            } satisfies LLMEvent;
          }

          // reasoning-delta
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

          // finish_reason — finalize tool calls
          if (choice?.finish_reason) {
            if (toolCalls.size > 0) {
              const sorted = [...toolCalls.entries()].sort(([a], [b]) => a - b);
              for (const [, tc] of sorted) {
                if (tc.name) {
                  yield {
                    type: 'tool-call',
                    id: tc.id ?? '',
                    name: tc.name,
                    input: tc.argumentsText ? parseJSON(tc.argumentsText) : {},
                  } satisfies LLMEvent;
                }
              }
              toolCalls.clear();
            }

            const reason = mapFinishReason(choice.finish_reason);
            const usage = event.usage ? mapUsage(event.usage) : undefined;

            yield {
              type: 'step-finish',
              index: 0,
              reason,
              usage,
            } satisfies LLMEvent;
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    // empty response → emit finish with stop
    yield {
      type: 'finish',
      reason: 'stop',
      usage: undefined,
    } satisfies LLMEvent;
  }
}

// ---------------------------------------------------------------------------
// Body building
// ---------------------------------------------------------------------------

function buildBody(
  model: string,
  messages: ReadonlyArray<Message>,
  tools?: ReadonlyArray<ToolDefinition>
) {
  return {
    model,
    messages: messages.map(lowerMessage),
    tools: tools?.map(lowerTool),
    stream: true,
    stream_options: { include_usage: true },
  };
}

function lowerMessage(msg: Message) {
  const content = msg.content;
  if (msg.role === 'user') {
    const text = extractText(content);
    return { role: 'user' as const, content: text };
  }
  if (msg.role === 'assistant') {
    const text = extractText(content);
    return { role: 'assistant' as const, content: text };
  }
  if (msg.role === 'tool') {
    // find tool-call id from metadata
    const id = (msg.metadata?.tool_call_id as string) ?? '';
    return {
      role: 'tool' as const,
      tool_call_id: id,
      content: extractText(content),
    };
  }
  if (msg.role === 'system') {
    return { role: 'system' as const, content: extractText(content) };
  }
  return { role: msg.role, content: extractText(content) };
}

function lowerTool(tool: ToolDefinition) {
  return {
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  };
}

function extractText(
  content: ReadonlyArray<{ type: string; text?: string }>
): string {
  return content
    .filter((p) => p.type === 'text')
    .map((p) => p.text ?? '')
    .join('');
}

// ---------------------------------------------------------------------------
// SSE parsing
// ---------------------------------------------------------------------------

function parseSSELine(line: string): SSEEvent | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('data:')) return null;
  const data = trimmed.slice('data:'.length).trim();
  if (data === '[DONE]') return null;
  try {
    return JSON.parse(data) as SSEEvent;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Finish reason mapping
// ---------------------------------------------------------------------------

function mapFinishReason(reason: string): FinishReason {
  if (reason === 'stop') return 'stop';
  if (reason === 'length') return 'length';
  if (reason === 'content_filter') return 'content_filter';
  if (reason === 'tool_calls') return 'tool_calls';
  return 'stop';
}

// ---------------------------------------------------------------------------
// Usage mapping
// ---------------------------------------------------------------------------

function mapUsage(usage: SSEUsage): Usage | undefined {
  return {
    inputTokens: usage.prompt_tokens,
    outputTokens: usage.completion_tokens,
    totalTokens: usage.total_tokens,
  };
}

// ---------------------------------------------------------------------------
// Safe JSON parse (empty string → {})
// ---------------------------------------------------------------------------

function parseJSON(text: string): unknown {
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// SSE wire types (narrow subset of OpenAI chat completion chunk)
// ---------------------------------------------------------------------------

interface SSEEvent {
  choices?: Array<{
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
  usage?: SSEUsage;
}

interface SSEUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}
