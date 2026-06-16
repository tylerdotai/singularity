// ProviderProfile interface — describes a model provider's capabilities and configuration

export interface ProviderProfile {
	readonly id: string;
	readonly name: string;
	readonly baseURL: string;
	readonly apiKeyEnvVar: string;
	readonly models: readonly string[];
	readonly defaultModel: string;
	readonly capabilities: {
		readonly streaming: boolean;
		readonly vision: boolean;
		readonly functionCalling: boolean;
	};
	readonly authType: "api_key" | "oauth";
}
