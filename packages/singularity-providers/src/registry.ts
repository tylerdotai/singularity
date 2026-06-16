// ProviderRegistry — in-memory registry of provider profiles

import type { ProviderProfile } from "./profile.js";

export class ProviderRegistry {
	private readonly profiles = new Map<string, ProviderProfile>();

	register(profile: ProviderProfile): void {
		this.profiles.set(profile.id, profile);
	}

	get(id: string): ProviderProfile | undefined {
		return this.profiles.get(id);
	}

	list(): ProviderProfile[] {
		return [...this.profiles.values()];
	}

	/**
	 * Resolve a provider by model name using prefix matching.
	 * e.g. "gpt-4o" → openai, "claude-3-5-sonnet" → anthropic
	 */
	resolve(model: string): ProviderProfile {
		// Direct lookup by model prefix
		for (const profile of this.profiles.values()) {
			const modelPrefix = (s: string) => s.split("-")[0] ?? "";
			if (
				profile.models.some(
					(m) =>
						model.startsWith(modelPrefix(m)) &&
						model.toLowerCase().includes(modelPrefix(m).toLowerCase()),
				)
			) {
				return profile;
			}
		}

		// Heuristic prefix matching
		// biome-ignore lint/style/noNonNullAssertion: split always returns at least 1 element
		const prefix = model.split("-")[0]!.toLowerCase();

		// gpt, o1, o3, o4 → OpenAI
		if (
			prefix === "gpt" ||
			prefix === "o1" ||
			prefix === "o3" ||
			prefix === "o4"
		) {
			const openai = this.profiles.get("openai");
			if (openai) return openai;
		}

		// claude → Anthropic
		if (prefix === "claude") {
			const anthropic = this.profiles.get("anthropic");
			if (anthropic) return anthropic;
		}

		// minimax → MiniMax
		if (prefix === "minimax") {
			const minimax = this.profiles.get("minimax");
			if (minimax) return minimax;
		}

		// deepseek → DeepSeek
		if (prefix === "deepseek") {
			const deepseek = this.profiles.get("deepseek");
			if (deepseek) return deepseek;
		}

		// gemini → Google Gemini
		if (prefix === "gemini") {
			const gemini = this.profiles.get("gemini");
			if (gemini) return gemini;
		}

		// openrouter → OpenRouter
		if (prefix === "openrouter") {
			const openrouter = this.profiles.get("openrouter");
			if (openrouter) return openrouter;
		}

		// xai, grok → xAI
		if (prefix === "xai" || prefix === "grok") {
			const xai = this.profiles.get("xai");
			if (xai) return xai;
		}

		// kimi → Kimi
		if (prefix === "kimi") {
			const kimi = this.profiles.get("kimi");
			if (kimi) return kimi;
		}

		// qwen → Qwen
		if (prefix === "qwen") {
			const qwen = this.profiles.get("qwen");
			if (qwen) return qwen;
		}

		// ollama → Ollama (local)
		if (prefix === "ollama") {
			const ollama = this.profiles.get("ollama");
			if (ollama) return ollama;
		}

		// Default to OpenAI if available
		const defaultProvider = this.profiles.get("openai");
		if (defaultProvider) return defaultProvider;

		throw new Error(`No provider found for model: ${model}`);
	}
}
