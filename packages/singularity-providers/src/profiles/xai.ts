import { XAI_MODELS } from "../models.js";
import type { ProviderProfile } from "../profile.js";

export const xaiProfile: ProviderProfile = {
	id: "xai",
	name: "xAI",
	baseURL: "https://api.x.ai/v1",
	apiKeyEnvVar: "XAI_API_KEY",
	models: [...XAI_MODELS],
	defaultModel: "xai/grok-2",
	capabilities: {
		streaming: true,
		vision: true,
		functionCalling: false,
	},
	authType: "api_key",
};
