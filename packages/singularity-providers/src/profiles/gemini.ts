import { GEMINI_MODELS } from "../models.js";
import type { ProviderProfile } from "../profile.js";

export const geminiProfile: ProviderProfile = {
	id: "gemini",
	name: "Google Gemini",
	baseURL: "https://generativelanguage.googleapis.com/v1beta",
	apiKeyEnvVar: "GEMINI_API_KEY",
	models: [...GEMINI_MODELS],
	defaultModel: "gemini-2.0-flash",
	capabilities: {
		streaming: true,
		vision: true,
		functionCalling: true,
	},
	authType: "api_key",
};
