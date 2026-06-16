import type {
  FinishReason,
  LLMEvent,
  Message,
  SystemPart,
  ToolDefinition,
  Usage,
} from './types.js';

const DEFAULT_BASE_URL = 'https://api.anthropic.com/v1';
const ANTHROPIC_VERSION = '2023-06-01';

interface AnthropicEvent {
  type: string;
  index?: number;
  message?: {
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
  };
  content_block?: {
    type: string;
    id?: string;
    name?: string;
    text?: string;
    thinking?: string;
    input?: unknown;
  };
  delta?: {
    type?: string;
    text?: string;
    thinking?: string;
    partial_json?: string;
    signature?: string;
    stop_reason?: string;
    stop_sequence?: string;
  };
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
  error?: {
    type?: string;
    message?: string;
  };
}

interface AnthropicMessageContent {
  type: 'text' | 'image';
  text?: string;
  source?: {
    type: 'base64';
    media_type: string;
    data: string;
  };
}

interface AnthropicBody {
  model: string;
  system?: AnthropicMessageContent[];
  messages: {
    role: 'user' | 'assistant';
    content: AnthropicMessageContent[];
  }[];
  tools?: {
    name: string;
    description: string;
    input_schema: unknown;
  }[];
  stream: true;
  max_tokens: number;
  thinking?: {
    type: 'enabled';
    budget_tokens: number;
  };
}

function lowerMessageContent(
  parts: ReadonlyArray<{ type: string; text?: string }>
): AnthropicMessageContent[] {
  const content: AnthropicMessageContent[] = [];
  for (const part of parts) {
    if (part.type === 'text' && part.text) {
      content.push({ type: 'text', text: part.text });
    }
  }
  return content;
}

function lowerMessages(messages: ReadonlyArray<Message>): {
  nonSystem: {
    role: 'user' | 'assistant';
    content: AnthropicMessageContent[];
  }[];
  system: AnthropicMessageContent[];
} {
  const nonSystem: {
    role: 'user' | 'assistant';
    content: AnthropicMessageContent[];
  }[] = [];
  const system: AnthropicMessageContent[] = [];
  for (const message of messages) {
    if (message.role === 'system') {
      const parts = message.content as { type: string; text?: string }[];
      for (const part of parts) {
        if (part.type === 'text' && part.text) {
          system.push({ type: 'text', text: part.text });
        }
      }
      continue;
    }
    if (message.role === 'user' || message.role === 'assistant') {
      nonSystem.push({
        role: message.role,
        content: lowerMessageContent(
          message.content as { type: string; text?: string }[]
        ),
      });
    }
  }
  return { nonSystem, system };
}

function buildBody(
  model: string,
  messages: ReadonlyArray<Message>,
  tools: ReadonlyArray<ToolDefinition> | undefined,
  maxTokens: number,
  thinkingEnabled: boolean
): AnthropicBody {
  const { nonSystem: anthropicMessages, system: anthropicSystem } =
    lowerMessages(messages);
  const anthropicTools = tools?.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema,
  }));

  return {
    model,
    system: anthropicSystem.length > 0 ? anthropicSystem : undefined,
    messages: anthropicMessages,
    tools: anthropicTools,
    stream: true,
    max_tokens: maxTokens,
    thinking: thinkingEnabled
      ? { type: 'enabled', budget_tokens: 1024 }
      : undefined,
  };
}

function mapStopReason(reason: string | undefined): FinishReason {
  if (
    reason === 'end_turn' ||
    reason === 'stop_sequence' ||
    reason === 'pause_turn'
  )
    return 'stop';
  if (reason === 'max_tokens') return 'max_tokens';
  if (reason === 'tool_use') return 'tool_calls';
  if (reason === 'refusal') return 'content_filter';
  return 'stop';
}

function mapUsage(usage: AnthropicEvent['usage']): Usage | undefined {
  if (!usage) return undefined;
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    totalTokens: (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0),
    reasoningTokens: undefined,
    cacheCreationInputTokens: usage.cache_creation_input_tokens,
    cacheHitInputTokens: usage.cache_read_input_tokens,
  };
}

export class AnthropicAdapter {
  constructor(
    private apiKey: string,
    private baseURL: string = DEFAULT_BASE_URL
  ) {}

  async *messages(
    model: string,
    messages: ReadonlyArray<Message>,
    tools?: ReadonlyArray<ToolDefinition>
  ): AsyncGenerator<LLMEvent> {
    const maxTokens = 4096;
    const thinkingEnabled = tools !== undefined;

    const body = buildBody(model, messages, tools, maxTokens, thinkingEnabled);

    const url = `${this.baseURL}/messages`;
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      yield {
        type: 'provider-error',
        message: `Network error: ${String(err)}`,
        classification: 'network-error',
        retryable: true,
      };
      return;
    }

    if (!response.ok) {
      const classification =
        response.status === 401
          ? 'authentication'
          : response.status === 429
            ? 'rate-limit'
            : response.status >= 500
              ? 'server-error'
              : 'client-error';
      yield {
        type: 'provider-error',
        message: `Anthropic API error ${response.status}: ${response.statusText}`,
        classification,
        retryable: response.status >= 500 || response.status === 429,
      };
      return;
    }

    if (!response.body) {
      yield {
        type: 'provider-error',
        message: 'Anthropic API returned empty response body',
      };
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let currentBlockIndex = 0;
    let currentBlockId = '';
    let currentBlockName = '';
    let currentTextId = '';
    let currentReasoningId = '';
    let usage: Usage | undefined;
    let pendingFinishReason: FinishReason | undefined;
    let pendingFinishUsage: Usage | undefined;

    const flushText = (events: LLMEvent[]) => {
      if (currentTextId) {
        events.push({ type: 'text-end', id: currentTextId });
        currentTextId = '';
      }
    };

    const flushReasoning = (events: LLMEvent[]) => {
      if (currentReasoningId) {
        events.push({ type: 'reasoning-end', id: currentReasoningId });
        currentReasoningId = '';
      }
    };

    const emitFinish = (events: LLMEvent[]) => {
      if (pendingFinishReason !== undefined) {
        events.push({
          type: 'finish',
          reason: pendingFinishReason,
          usage: pendingFinishUsage,
        });
        pendingFinishReason = undefined;
        pendingFinishUsage = undefined;
      }
    };

    const processEvent = (rawEvent: AnthropicEvent): LLMEvent[] => {
      const events: LLMEvent[] = [];

      if (rawEvent.type === 'message_start') {
        usage = mapUsage(rawEvent.message?.usage);
        pendingFinishReason = undefined;
        pendingFinishUsage = undefined;
      } else if (rawEvent.type === 'content_block_start') {
        const block = rawEvent.content_block;
        if (!block) return events;
        currentBlockIndex = rawEvent.index ?? 0;

        if (block.type === 'text' && block.text) {
          currentTextId = `text-${currentBlockIndex}`;
          events.push({ type: 'text-start', id: currentTextId });
        } else if (block.type === 'tool_use') {
          currentBlockId = block.id ?? String(currentBlockIndex);
          currentBlockName = block.name ?? '';
          events.push({
            type: 'tool-input-start',
            id: currentBlockId,
            name: currentBlockName,
          });
        } else if (block.type === 'thinking') {
          currentReasoningId = `reasoning-${currentBlockIndex}`;
          events.push({ type: 'reasoning-start', id: currentReasoningId });
          if (block.thinking) {
            events.push({
              type: 'reasoning-delta',
              id: currentReasoningId,
              text: block.thinking,
            });
          }
        }
      } else if (rawEvent.type === 'content_block_delta') {
        const delta = rawEvent.delta;
        if (!delta) return events;

        if (delta.type === 'text_delta' && delta.text) {
          events.push({
            type: 'text-delta',
            id: currentTextId,
            text: delta.text,
          });
        } else if (delta.type === 'thinking_delta' && delta.thinking) {
          events.push({
            type: 'reasoning-delta',
            id: currentReasoningId,
            text: delta.thinking,
          });
        } else if (delta.type === 'input_json_delta' && delta.partial_json) {
          events.push({
            type: 'tool-input-delta',
            id: currentBlockId,
            name: currentBlockName,
            text: delta.partial_json,
          });
        }
      } else if (rawEvent.type === 'content_block_stop') {
        if (currentTextId) {
          flushText(events);
        }
        if (currentReasoningId) {
          flushReasoning(events);
        }
        if (currentBlockId) {
          events.push({
            type: 'tool-input-end',
            id: currentBlockId,
            name: currentBlockName,
          });
          events.push({
            type: 'tool-call',
            id: currentBlockId,
            name: currentBlockName,
            input: undefined,
          });
          currentBlockId = '';
          currentBlockName = '';
        }
      } else if (rawEvent.type === 'message_delta') {
        if (rawEvent.usage) {
          usage = mapUsage(rawEvent.usage);
        }
        pendingFinishReason = mapStopReason(rawEvent.delta?.stop_reason);
        pendingFinishUsage = usage;
      } else if (rawEvent.type === 'message_stop') {
        emitFinish(events);
      } else if (rawEvent.type === 'error') {
        const msg = rawEvent.error?.message ?? 'Unknown Anthropic stream error';
        events.push({
          type: 'provider-error',
          message: msg,
          classification:
            msg.includes('overload') || msg.includes('rate limit')
              ? 'rate-limit'
              : undefined,
          retryable: rawEvent.error?.type === 'rate_limit_error',
        });
      }

      return events;
    };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (!line?.startsWith('event: ')) continue;
          const nextLine = lines[i + 1];
          if (!nextLine?.startsWith('data: ')) continue;
          i++;

          let rawEvent: AnthropicEvent;
          try {
            rawEvent = JSON.parse(nextLine.slice(6)) as AnthropicEvent;
          } catch {
            continue;
          }

          const events = processEvent(rawEvent);
          for (const event of events) {
            yield event;
          }
        }
      }

      if (buffer.trim()) {
        const lines = buffer.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (!line?.startsWith('event: ')) continue;
          const nextLine = lines[i + 1];
          if (!nextLine?.startsWith('data: ')) continue;
          i++;

          let rawEvent: AnthropicEvent;
          try {
            rawEvent = JSON.parse(nextLine.slice(6)) as AnthropicEvent;
          } catch {
            continue;
          }

          if (rawEvent.type === 'message_stop') {
            const events: LLMEvent[] = [];
            emitFinish(events);
            for (const event of events) {
              yield event;
            }
          }
        }
      }

      if (pendingFinishReason !== undefined) {
        yield {
          type: 'finish',
          reason: pendingFinishReason,
          usage: pendingFinishUsage,
        };
        pendingFinishReason = undefined;
        pendingFinishUsage = undefined;
      }
    } finally {
      reader.releaseLock();
    }
  }
}
