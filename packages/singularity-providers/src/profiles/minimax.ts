import { MINIMAX_MODELS } from "../models.js";
import type { ProviderProfile } from "../profile.js";

export const minimaxProfile: ProviderProfile = {
	id: "minimax",
	name: "MiniMax",
	baseURL: "https://api.minimax.io/v1",
	apiKeyEnvVar: "MINIMAX_API_KEY",
	models: [...MINIMAX_MODELS],
	defaultModel: "MiniMax-Text-01",
	capabilities: {
		streaming: true,
		vision: true,
		functionCalling: true,
	},
	authType: "api_key",
};
