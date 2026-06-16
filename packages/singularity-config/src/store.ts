import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
	ConfigSchema,
	type ConfigSchemaType,
	defaultConfig,
} from "./schema.js";

const CONFIG_PATH = join(homedir(), ".singularity", "config.json");

type Subscriber = (config: ConfigSchemaType) => void;

function ensureDir(dir: string): void {
	mkdirSync(dir, { recursive: true });
}

function loadConfig(): ConfigSchemaType {
	try {
		const data = readFileSync(CONFIG_PATH, "utf-8");
		const parsed = JSON.parse(data);
		const result = ConfigSchema.safeParse(parsed);
		if (result.success) {
			return result.data;
		}
		// Fall back to defaults on parse error
		return { ...defaultConfig };
	} catch {
		// File doesn't exist or is unreadable — use defaults
		return { ...defaultConfig };
	}
}

function saveConfig(config: ConfigSchemaType): void {
	ensureDir(join(homedir(), ".singularity"));
	// Atomic write via temp file + rename
	const tmp = `${CONFIG_PATH}.tmp`;
	writeFileSync(tmp, JSON.stringify(config, null, 2), "utf-8");
	// Rename is atomic on POSIX
	readFileSync(tmp); // verify write succeeded
	writeFileSync(CONFIG_PATH, readFileSync(tmp));
}

/** Dot-path getter: get(config, "core.model") or get(config) for full object */
function get<T = ConfigSchemaType>(
	config: ConfigSchemaType,
	path?: string,
): T | unknown {
	if (!path) return config;
	const parts = path.split(".");
	let current: unknown = config;
	for (const part of parts) {
		if (current === null || current === undefined) return undefined;
		if (typeof current !== "object") return undefined;
		current = (current as Record<string, unknown>)[part];
	}
	return current as T;
}

/** Dot-path setter: set(config, "core.model", "gpt-4") */
function set(
	config: ConfigSchemaType,
	path: string,
	value: unknown,
): ConfigSchemaType {
	const parts = path.split(".");
	const result = structuredClone(config);
	let current: Record<string, unknown> = result;
	for (let i = 0; i < parts.length - 1; i++) {
		const part = parts[i];
		if (!(part in current) || typeof current[part] !== "object") {
			current[part] = {};
		}
		current = current[part] as Record<string, unknown>;
	}
	current[parts[parts.length - 1]] = value;
	return result;
}

class ConfigStore {
	private config: ConfigSchemaType;

	private subscribers = new Set<Subscriber>();

	constructor() {
		this.config = loadConfig();
	}

	get(path?: string): ConfigSchemaType | unknown {
		return get(this.config, path);
	}

	set(path: string, value: unknown): void {
		this.config = set(this.config, path, value);
		saveConfig(this.config);
		this.notify();
	}

	reset(): void {
		this.config = { ...defaultConfig };
		saveConfig(this.config);
		this.notify();
	}

	subscribe(fn: Subscriber): () => void {
		this.subscribers.add(fn);
		return () => this.subscribers.delete(fn);
	}

	private notify(): void {
		for (const fn of this.subscribers) {
			fn(this.config);
		}
	}
}

export const configStore = new ConfigStore();
export type { ConfigStore };
