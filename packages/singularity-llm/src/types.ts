// LLMRequest
export interface LLMRequest {
  model: Model;
  system: ReadonlyArray<SystemPart>;
  messages: ReadonlyArray<Message>;
  tools?: ReadonlyArray<ToolDefinition>;
  toolChoice?: ToolChoice;
  generation?: GenerationOptions;
  providerOptions?: ProviderOptions;
  cache?: CachePolicy;
}

// Message
export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';
export interface Message {
  id?: string;
  role: MessageRole;
  content: ReadonlyArray<ContentPart>;
  metadata?: Record<string, unknown>;
}
export type ContentPart =
  | TextPart
  | ToolCallPart
  | ToolResultPart
  | ReasoningPart;
export interface TextPart {
  type: 'text';
  text: string;
}
export interface ToolCallPart {
  type: 'tool-call';
  id: string;
  name: string;
  input: unknown;
}
export interface ToolResultPart {
  type: 'tool-result';
  id: string;
  name: string;
  result: ToolResultValue;
}
export interface ReasoningPart {
  type: 'reasoning';
  text: string;
}

// LLMEvent discriminated union
export type LLMEvent =
  | { type: 'text-start'; id: string }
  | { type: 'text-delta'; id: string; text: string }
  | { type: 'text-end'; id: string }
  | { type: 'reasoning-start'; id: string }
  | { type: 'reasoning-delta'; id: string; text: string }
  | { type: 'reasoning-end'; id: string }
  | { type: 'tool-input-start'; id: string; name: string }
  | { type: 'tool-input-delta'; id: string; name: string; text: string }
  | { type: 'tool-input-end'; id: string; name: string }
  | {
      type: 'tool-call';
      id: string;
      name: string;
      input: unknown;
      providerExecuted?: boolean;
    }
  | { type: 'tool-result'; id: string; name: string; result: ToolResultValue }
  | { type: 'tool-error'; id: string; name: string; message: string }
  | { type: 'step-finish'; index: number; reason: FinishReason; usage?: Usage }
  | { type: 'finish'; reason: FinishReason; usage?: Usage }
  | {
      type: 'provider-error';
      message: string;
      classification?: string;
      retryable?: boolean;
    };

// ToolDefinition
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: unknown; // JSON Schema object
  outputSchema?: unknown;
}

// ToolResultValue
export type ToolResultValue =
  | { type: 'json'; value: unknown }
  | { type: 'text'; value: string }
  | { type: 'error'; value: string }
  | { type: 'content'; value: ReadonlyArray<{ type: 'text'; text: string }> };

// Model
export interface Model {
  id: string;
  provider: string;
}

// ProviderConfig
export interface ProviderConfig {
  apiKey?: string;
  baseURL?: string;
}

// Usage
export interface Usage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
  cacheCreationInputTokens?: number;
  cacheHitInputTokens?: number;
}

// FinishReason
export type FinishReason =
  | 'stop'
  | 'max_tokens'
  | 'length'
  | 'content_filter'
  | 'tool_calls'
  | 'max_iterations';

// GenerationOptions
export interface GenerationOptions {
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  stop?: string[];
}

// ProviderOptions
export interface ProviderOptions {
  openai?: { promptCacheKey?: string };
  anthropic?: { promptCacheKey?: string };
}

// CachePolicy
export type CachePolicy =
  | 'auto'
  | 'none'
  | {
      tools?: boolean;
      system?: boolean;
      messages?: boolean;
      ttlSeconds?: number;
    };

// ToolChoice
export interface ToolChoice {
  type: 'auto' | 'none' | 'required' | 'tool';
  name?: string;
}

// SystemPart
export interface SystemPart {
  type: 'text';
  text: string;
}
