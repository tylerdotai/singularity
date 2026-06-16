import { ANTHROPIC_MODELS } from "../models.js";
import type { ProviderProfile } from "../profile.js";

export const anthropicProfile: ProviderProfile = {
	id: "anthropic",
	name: "Anthropic",
	baseURL: "https://api.anthropic.com/v1",
	apiKeyEnvVar: "ANTHROPIC_API_KEY",
	models: [...ANTHROPIC_MODELS],
	defaultModel: "claude-3-5-sonnet",
	capabilities: {
		streaming: true,
		vision: true,
		functionCalling: true,
	},
	authType: "api_key",
};
