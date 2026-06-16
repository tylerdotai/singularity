import { DEEPSEEK_MODELS } from "../models.js";
import type { ProviderProfile } from "../profile.js";

export const deepseekProfile: ProviderProfile = {
	id: "deepseek",
	name: "DeepSeek",
	baseURL: "https://api.deepseek.com/v1",
	apiKeyEnvVar: "DEEPSEEK_API_KEY",
	models: [...DEEPSEEK_MODELS],
	defaultModel: "deepseek-chat",
	capabilities: {
		streaming: true,
		vision: false,
		functionCalling: true,
	},
	authType: "api_key",
};
