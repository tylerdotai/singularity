import { z } from "zod";

// Core config
const coreSchema = z.object({
	model: z.string(),
	provider: z.string(),
	apiKey: z.string().optional(),
	baseURL: z.string().optional(),
});

// Providers (keyed by provider name)
const providersSchema = z.record(
	z.object({
		apiKey: z.string(),
		model: z.string().optional(),
		baseURL: z.string().optional(),
	}),
);

// Tools
const toolsSchema = z.object({
	browser: z.object({ enabled: z.boolean() }),
	homeAssistant: z.object({ enabled: z.boolean() }),
	kanban: z.object({ enabled: z.boolean() }),
	computerUse: z.object({ enabled: z.boolean() }),
	defaultToolsets: z.array(z.string()),
});

// Platform
const platformSchema = z.object({
	telegram: z.object({
		botToken: z.string().optional(),
		allowedChats: z.array(z.string()),
	}),
	discord: z.object({
		botToken: z.string().optional(),
		allowedChats: z.array(z.string()),
	}),
});

// Memory
const memorySchema = z.object({
	contextTokenBudget: z.number(),
	compressionThreshold: z.number(),
	sessionRetentionDays: z.number(),
	maxFactAgeDays: z.number(),
});

// Risk thresholds
const riskSchema = z.object({
	approvalThreshold: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
	criticalTools: z.array(z.string()),
});

// Engine defaults
const engineSchema = z.object({
	maxSteps: z.number(),
	bufferSize: z.number(),
	keepTokens: z.number(),
	summaryTokens: z.number(),
	contextWindow: z.number(),
	model: z.string(),
});

export const ConfigSchema = z.object({
	core: coreSchema,
	providers: providersSchema,
	tools: toolsSchema,
	platform: platformSchema,
	memory: memorySchema,
	risk: riskSchema,
	engine: engineSchema,
});

export type ConfigSchemaType = z.infer<typeof ConfigSchema>;

export const defaultConfig: ConfigSchemaType = {
	core: {
		model: "",
		provider: "",
	},
	providers: {},
	tools: {
		browser: { enabled: false },
		homeAssistant: { enabled: false },
		kanban: { enabled: false },
		computerUse: { enabled: false },
		defaultToolsets: [],
	},
	platform: {
		telegram: { botToken: undefined, allowedChats: [] },
		discord: { botToken: undefined, allowedChats: [] },
	},
	memory: {
		contextTokenBudget: 100000,
		compressionThreshold: 0.85,
		sessionRetentionDays: 30,
		maxFactAgeDays: 90,
	},
	risk: {
		approvalThreshold: "LOW",
		criticalTools: [],
	},
	engine: {
		maxSteps: 25,
		bufferSize: 20000,
		keepTokens: 8000,
		summaryTokens: 4096,
		contextWindow: 128000,
		model: "gpt-4o",
	},
};
