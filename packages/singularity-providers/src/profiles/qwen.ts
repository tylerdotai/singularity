import { QWEN_MODELS } from "../models.js";
import type { ProviderProfile } from "../profile.js";

export const qwenProfile: ProviderProfile = {
	id: "qwen",
	name: "Qwen",
	baseURL: "https://dashscope.aliyuncs.com/api/v1",
	apiKeyEnvVar: "QWEN_API_KEY",
	models: [...QWEN_MODELS],
	defaultModel: "qwen-turbo",
	capabilities: {
		streaming: true,
		vision: true,
		functionCalling: true,
	},
	authType: "api_key",
};
