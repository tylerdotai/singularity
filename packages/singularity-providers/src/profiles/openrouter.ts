import { OPENROUTER_MODELS } from "../models.js";
import type { ProviderProfile } from "../profile.js";

export const openrouterProfile: ProviderProfile = {
	id: "openrouter",
	name: "OpenRouter",
	baseURL: "https://openrouter.ai/api/v1",
	apiKeyEnvVar: "OPENROUTER_API_KEY",
	models: [...OPENROUTER_MODELS],
	defaultModel: "openrouter/auto",
	capabilities: {
		streaming: true,
		vision: true,
		functionCalling: true,
	},
	authType: "api_key",
};
