import { KIMI_MODELS } from "../models.js";
import type { ProviderProfile } from "../profile.js";

export const kimiProfile: ProviderProfile = {
	id: "kimi",
	name: "Kimi",
	baseURL: "https://api.moonshot.cn/v1",
	apiKeyEnvVar: "KIMI_API_KEY",
	models: [...KIMI_MODELS],
	defaultModel: "kimi-chat",
	capabilities: {
		streaming: true,
		vision: true,
		functionCalling: true,
	},
	authType: "api_key",
};
