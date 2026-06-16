// singularity-providers — Model provider registry and resolution

// Model lists
export {
	ANTHROPIC_MODELS,
	DEEPSEEK_MODELS,
	GEMINI_MODELS,
	KIMI_MODELS,
	MINIMAX_MODELS,
	OLLAMA_MODELS,
	OPENAI_MODELS,
	OPENROUTER_MODELS,
	QWEN_MODELS,
	XAI_MODELS,
} from "./models.js";
export type { ProviderProfile } from "./profile.js";
export { anthropicProfile } from "./profiles/anthropic.js";
export { deepseekProfile } from "./profiles/deepseek.js";
export { geminiProfile } from "./profiles/gemini.js";
export { kimiProfile } from "./profiles/kimi.js";
export { minimaxProfile } from "./profiles/minimax.js";
export { ollamaProfile } from "./profiles/ollama.js";
// Provider profiles
export { openaiProfile } from "./profiles/openai.js";
export { openrouterProfile } from "./profiles/openrouter.js";
export { qwenProfile } from "./profiles/qwen.js";
export { xaiProfile } from "./profiles/xai.js";
export { ProviderRegistry } from "./registry.js";
export type { LLMAdapter } from "./resolver.js";
export {
	createLLM,
	createLLMFromProfile,
	resolveProvider,
} from "./resolver.js";
