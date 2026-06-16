import { OPENAI_MODELS } from "../models.js";
import type { ProviderProfile } from "../profile.js";

export const openaiProfile: ProviderProfile = {
	id: "openai",
	name: "OpenAI",
	baseURL: "https://api.openai.com/v1",
	apiKeyEnvVar: "OPENAI_API_KEY",
	models: [...OPENAI_MODELS],
	defaultModel: "gpt-4o",
	capabilities: {
		streaming: true,
		vision: true,
		functionCalling: true,
	},
	authType: "api_key",
};
