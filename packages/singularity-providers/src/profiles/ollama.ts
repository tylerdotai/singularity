import { OLLAMA_MODELS } from "../models.js";
import type { ProviderProfile } from "../profile.js";

export const ollamaProfile: ProviderProfile = {
	id: "ollama",
	name: "Ollama",
	baseURL: "http://localhost:11434",
	apiKeyEnvVar: "OLLAMA_API_KEY",
	models: [...OLLAMA_MODELS],
	defaultModel: "llama3.1",
	capabilities: {
		streaming: true,
		vision: false,
		functionCalling: false,
	},
	authType: "api_key",
};
