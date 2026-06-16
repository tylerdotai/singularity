// Resolver — resolves model names to provider profiles and creates LLM adapters

import type { LLMEvent, Message, ToolDefinition } from "singularity-llm";
import {
	AnthropicAdapter,
	MiniMaxAdapter,
	OpenAIAdapter,
} from "singularity-llm";
import type { ProviderProfile } from "./profile.js";
import { anthropicProfile } from "./profiles/anthropic.js";
import { deepseekProfile } from "./profiles/deepseek.js";
import { geminiProfile } from "./profiles/gemini.js";
import { kimiProfile } from "./profiles/kimi.js";
import { minimaxProfile } from "./profiles/minimax.js";
import { ollamaProfile } from "./profiles/ollama.js";
import { openaiProfile } from "./profiles/openai.js";
import { openrouterProfile } from "./profiles/openrouter.js";
import { qwenProfile } from "./profiles/qwen.js";
import { xaiProfile } from "./profiles/xai.js";
import { ProviderRegistry } from "./registry.js";

// ---------------------------------------------------------------------------
// LLMAdapter interface
// ---------------------------------------------------------------------------

export interface LLMAdapter {
	readonly provider: string;
	readonly model: string;
	chat(
		messages: ReadonlyArray<Message>,
		options?: { tools?: ReadonlyArray<ToolDefinition> },
	): AsyncGenerator<LLMEvent>;
}

// ---------------------------------------------------------------------------
// Adapter wrappers to match LLMAdapter interface
// ---------------------------------------------------------------------------

class OpenAIAdapterWrapper implements LLMAdapter {
	readonly provider = "openai";
	readonly model: string;
	private readonly adapter: OpenAIAdapter;

	constructor(apiKey: string, baseURL: string, model: string) {
		this.model = model;
		this.adapter = new OpenAIAdapter(apiKey, baseURL);
	}

	async *chat(
		messages: ReadonlyArray<Message>,
		options?: { tools?: ReadonlyArray<ToolDefinition> },
	): AsyncGenerator<LLMEvent> {
		yield* this.adapter.chat(this.model, messages, options?.tools);
	}
}

class AnthropicAdapterWrapper implements LLMAdapter {
	readonly provider = "anthropic";
	readonly model: string;
	private readonly adapter: AnthropicAdapter;

	constructor(apiKey: string, baseURL: string, model: string) {
		this.model = model;
		this.adapter = new AnthropicAdapter(apiKey, baseURL);
	}

	async *chat(
		messages: ReadonlyArray<Message>,
		options?: { tools?: ReadonlyArray<ToolDefinition> },
	): AsyncGenerator<LLMEvent> {
		yield* this.adapter.messages(this.model, messages, options?.tools);
	}
}

class MiniMaxAdapterWrapper implements LLMAdapter {
	readonly provider = "minimax";
	readonly model: string;
	private readonly adapter: MiniMaxAdapter;

	constructor(apiKey: string, baseURL: string, model: string) {
		this.model = model;
		this.adapter = new MiniMaxAdapter(apiKey, baseURL, model);
	}

	async *chat(
		messages: ReadonlyArray<Message>,
		options?: { tools?: ReadonlyArray<ToolDefinition> },
	): AsyncGenerator<LLMEvent> {
		yield* this.adapter.chat(messages, { tools: options?.tools });
	}
}

// ---------------------------------------------------------------------------
// Default registry with all built-in providers
// ---------------------------------------------------------------------------

const defaultRegistry = new ProviderRegistry();

// Register all built-in providers
defaultRegistry.register(openaiProfile);
defaultRegistry.register(anthropicProfile);
defaultRegistry.register(minimaxProfile);
defaultRegistry.register(openrouterProfile);
defaultRegistry.register(deepseekProfile);
defaultRegistry.register(xaiProfile);
defaultRegistry.register(geminiProfile);
defaultRegistry.register(kimiProfile);
defaultRegistry.register(qwenProfile);
defaultRegistry.register(ollamaProfile);

// ---------------------------------------------------------------------------
// Resolve provider by model name
// ---------------------------------------------------------------------------

export function resolveProvider(model: string): ProviderProfile {
	return defaultRegistry.resolve(model);
}

// ---------------------------------------------------------------------------
// Create LLM adapter from profile
// ---------------------------------------------------------------------------

export function createLLMFromProfile(
	profile: ProviderProfile,
	model?: string,
): LLMAdapter {
	const apiKey = process.env[profile.apiKeyEnvVar] ?? "";
	const resolvedModel = model ?? profile.defaultModel;

	switch (profile.id) {
		case "openai":
			return new OpenAIAdapterWrapper(apiKey, profile.baseURL, resolvedModel);

		case "anthropic":
			return new AnthropicAdapterWrapper(
				apiKey,
				profile.baseURL,
				resolvedModel,
			);

		case "minimax":
			return new MiniMaxAdapterWrapper(apiKey, profile.baseURL, resolvedModel);

		case "openrouter":
			// OpenRouter uses OpenAI-compatible API
			return new OpenAIAdapterWrapper(apiKey, profile.baseURL, resolvedModel);

		case "deepseek":
			// DeepSeek uses OpenAI-compatible API
			return new OpenAIAdapterWrapper(apiKey, profile.baseURL, resolvedModel);

		case "gemini":
			// Gemini uses a different API structure, fall back to OpenAI adapter with baseURL
			// Note: In production, you'd want a dedicated GeminiAdapter
			return new OpenAIAdapterWrapper(apiKey, profile.baseURL, resolvedModel);

		case "kimi":
			// Kimi uses OpenAI-compatible API
			return new OpenAIAdapterWrapper(apiKey, profile.baseURL, resolvedModel);

		case "qwen":
			// Qwen uses OpenAI-compatible API
			return new OpenAIAdapterWrapper(apiKey, profile.baseURL, resolvedModel);

		case "xai":
			// xAI uses OpenAI-compatible API
			return new OpenAIAdapterWrapper(apiKey, profile.baseURL, resolvedModel);

		case "ollama":
			// Ollama uses OpenAI-compatible API at localhost
			return new OpenAIAdapterWrapper(apiKey, profile.baseURL, resolvedModel);

		default:
			throw new Error(`Unsupported provider: ${profile.id}`);
	}
}

// ---------------------------------------------------------------------------
// Convenience: create LLM from model string
// ---------------------------------------------------------------------------

export function createLLM(model: string): LLMAdapter {
	const profile = resolveProvider(model);
	return createLLMFromProfile(profile, model);
}
