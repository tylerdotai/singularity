// Curated model lists per provider

export const OPENAI_MODELS = [
	"gpt-4o",
	"gpt-4o-mini",
	"gpt-4-turbo",
	"gpt-4",
	"gpt-3.5-turbo",
	"o1-preview",
	"o1-mini",
	"o3-mini",
	"o4-mini",
] as const;

export const ANTHROPIC_MODELS = [
	"claude-3-5-sonnet",
	"claude-3-5-haiku",
	"claude-3-opus",
	"claude-3-sonnet",
	"claude-3-haiku",
] as const;

export const MINIMAX_MODELS = [
	"MiniMax-Text-01",
	"MiniMax-Text-01-Mini",
	"MiniMax-M3",
	"MiniMax-M3-mini",
] as const;

export const OPENROUTER_MODELS = [
	"openrouter/auto",
	"openrouter/google/gemini-pro-1.5",
	"openrouter/anthropic/claude-3.5-sonnet",
	"openrouter/meta-llama/llama-3-8b",
	"openrouter/mistralai/mistral-7b",
] as const;

export const DEEPSEEK_MODELS = [
	"deepseek-chat",
	"deepseek-coder",
	"deepseek-chat-v2",
	"deepseek-chat-v3",
] as const;

export const XAI_MODELS = [
	"xai/grok-2",
	"xai/grok-2-mini",
	"xai/grok-beta",
] as const;

export const GEMINI_MODELS = [
	"gemini-2.0-flash",
	"gemini-1.5-flash",
	"gemini-1.5-pro",
	"gemini-1.0-pro",
	"gemini-pro",
	"gemini-pro-vision",
] as const;

export const KIMI_MODELS = [
	"kimi-chat",
	"kimi-chat-alpha",
	"kimi-pro",
	"kimi-vl",
] as const;

export const QWEN_MODELS = [
	"qwen-turbo",
	"qwen-plus",
	"qwen-max",
	"qwen-long",
	"qwen-vl-max",
	"qwen-vl-plus",
] as const;

export const OLLAMA_MODELS = [
	"llama3.1",
	"llama3",
	"llama2",
	"mistral",
	"codellama",
	"phi3",
	"qwen2.5",
	"deepseek-v2",
] as const;

export type OpenAIModel = (typeof OPENAI_MODELS)[number];
export type AnthropicModel = (typeof ANTHROPIC_MODELS)[number];
export type MiniMaxModel = (typeof MINIMAX_MODELS)[number];
export type OpenRouterModel = (typeof OPENROUTER_MODELS)[number];
export type DeepSeekModel = (typeof DEEPSEEK_MODELS)[number];
export type XAIModel = (typeof XAI_MODELS)[number];
export type GeminiModel = (typeof GEMINI_MODELS)[number];
export type KimiModel = (typeof KIMI_MODELS)[number];
export type QwenModel = (typeof QWEN_MODELS)[number];
export type OllamaModel = (typeof OLLAMA_MODELS)[number];
