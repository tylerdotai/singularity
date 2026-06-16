import { ConfigSchema } from "./schema.js";
import { configStore } from "./store.js";

export interface ValidationResult {
	valid: boolean;
	errors: string[];
	warnings: string[];
}

// Known tool names for validation
const KNOWN_TOOLS = new Set([
	"Read",
	"Edit",
	"Bash",
	"Grep",
	"Glob",
	"WebFetch",
	"WebSearch",
	"browser",
	"homeAssistant",
	"kanban",
	"computer_use",
	"mcpRecallFacts",
]);

// API key format hints per provider
const PROVIDER_KEY_PATTERNS: Record<
	string,
	{ prefix?: string; minLength: number; pattern?: RegExp }
> = {
	openai: { prefix: "sk-", minLength: 40 },
	anthropic: { prefix: "sk-ant-", minLength: 40 },
	minimax: { minLength: 20 },
	openrouter: { prefix: "sk-or-", minLength: 40 },
	groq: { prefix: "gsk_", minLength: 40 },
	ollama: { minLength: 0 },
	local: { minLength: 0 },
};

/** Mask sensitive value for display in errors */
function mask(value: string): string {
	if (value.length <= 8) return "***";
	return `${value.slice(0, 4)}***${value.slice(-4)}`;
}

/** Validate a single provider's API key format */
function validateApiKeyFormat(
	provider: string,
	apiKey: string | undefined,
): string[] {
	const errors: string[] = [];
	if (apiKey === undefined || apiKey === "") return errors;

	const hints = PROVIDER_KEY_PATTERNS[provider.toLowerCase()];
	if (!hints) {
		// Unknown provider - don't error on key format, just warn
		return errors;
	}

	if (hints.prefix && !apiKey.startsWith(hints.prefix)) {
		errors.push(
			`Provider '${provider}' API key format appears invalid (expected prefix '${hints.prefix}', got '${mask(apiKey)}')`,
		);
	}

	if (apiKey.length < hints.minLength) {
		errors.push(
			`Provider '${provider}' API key too short (min ${hints.minLength}, got ${apiKey.length})`,
		);
	}

	return errors;
}

/** Validate tool names against known registry */
function validateToolNames(enabledTools: string[]): string[] {
	const errors: string[] = [];
	for (const tool of enabledTools) {
		// Normalize: allow 'computer-use' or 'computer_use' variants
		const normalized = tool.replace(/-/g, "_");
		if (
			!KNOWN_TOOLS.has(tool) &&
			!KNOWN_TOOLS.has(normalized) &&
			!KNOWN_TOOLS.has(tool.replace(/_/g, ""))
		) {
			errors.push(`Unknown tool name: '${tool}'`);
		}
	}
	return errors;
}

export function validateStartup(): ValidationResult {
	const result: ValidationResult = { valid: true, errors: [], warnings: [] };

	// 1. Parse config with Zod
	const config = configStore.get();
	const parseResult = ConfigSchema.safeParse(config);

	if (!parseResult.success) {
		result.valid = false;
		for (const issue of parseResult.error.issues) {
			result.errors.push(
				`Schema error: ${issue.path.join(".")} — ${issue.message}`,
			);
		}
		return result;
	}

	const cfg = parseResult.data;

	// 2. Check required fields
	if (!cfg.core.model || cfg.core.model.trim() === "") {
		result.errors.push("Required field missing: 'core.model'");
	}
	if (!cfg.core.provider || cfg.core.provider.trim() === "") {
		result.errors.push("Required field missing: 'core.provider'");
	}

	// 3. Validate API key format per provider
	const providers = Object.entries(cfg.providers);
	if (
		providers.length === 0 &&
		(!cfg.core.apiKey || cfg.core.apiKey.trim() === "")
	) {
		result.warnings.push("No providers configured and no core API key set");
	}

	for (const [providerName, providerCfg] of providers) {
		result.errors.push(
			...validateApiKeyFormat(providerName, providerCfg.apiKey),
		);
	}

	// Also check core apiKey if set
	if (cfg.core.apiKey) {
		result.errors.push(
			...validateApiKeyFormat(cfg.core.provider, cfg.core.apiKey),
		);
	}

	// 4. Validate tool names
	if (cfg.tools.defaultToolsets && cfg.tools.defaultToolsets.length > 0) {
		result.errors.push(...validateToolNames(cfg.tools.defaultToolsets));
	}

	// Check for critical tools in risk config
	for (const tool of cfg.risk.criticalTools) {
		if (!KNOWN_TOOLS.has(tool) && !KNOWN_TOOLS.has(tool.replace(/-/g, "_"))) {
			result.warnings.push(`Risk config references unknown tool: '${tool}'`);
		}
	}

	// 5. Validate memory budget
	if (cfg.memory.contextTokenBudget < 10000) {
		result.warnings.push(
			`Memory token budget is very low (${cfg.memory.contextTokenBudget}), compression may be aggressive`,
		);
	}
	if (
		cfg.memory.compressionThreshold < 0.5 ||
		cfg.memory.compressionThreshold > 1
	) {
		result.errors.push(
			`Invalid compression threshold: ${cfg.memory.compressionThreshold} (must be 0.5–1)`,
		);
	}

	// 6. Platform validation
	if (!cfg.platform.telegram?.botToken && !cfg.platform.discord?.botToken) {
		result.warnings.push(
			"No platform bot token configured — gateway will not be able to receive events",
		);
	}

	result.valid = result.errors.length === 0;
	return result;
}
