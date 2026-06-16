import { Database } from "bun:sqlite";
import { beforeEach, describe, expect, test } from "bun:test";
import { FactStore, SessionStore } from "singularity-core/memory";
import { handleInitialize } from "./handlers/initialize.ts";
import { handlePromptsList } from "./handlers/prompts.ts";
import { handleResourcesList } from "./handlers/resources.ts";
import { handleShutdown } from "./handlers/shutdown.ts";
import {
	handleToolsCall,
	handleToolsList,
	initializeStores,
} from "./handlers/tools.ts";
import type { JsonRpcRequest, JsonRpcResponse } from "./protocol.ts";

// Test fixture: fresh in-memory database with migrations applied
function createTestDb() {
	const db = new Database(":memory:");

	// Create stores and run migrations
	const factStore = new FactStore(db);
	factStore.migrate(); // Creates facts table

	const sessionStore = new SessionStore(db);
	// Sessions table is created via migrations - run via db.exec
	db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      runtime TEXT NOT NULL,
      runtime_session_id TEXT,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      duration_min INTEGER,
      label TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      body TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      transcript_kind TEXT,
      transcript_path TEXT,
      transcript_offset INTEGER,
      transcript_length INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

	// Initialize the module's stores with our db
	initializeStores(db);

	return db;
}

describe("singularity-mcp handlers", () => {
	let db: Database;

	beforeEach(() => {
		db = createTestDb();
	});

	describe("initialize", () => {
		test("returns protocol version and server info", () => {
			const request: JsonRpcRequest = {
				jsonrpc: "2.0",
				id: 1,
				method: "initialize",
				params: {
					protocolVersion: "2024-11-05",
					capabilities: {},
					clientInfo: { name: "test-client", version: "1.0.0" },
				},
			};

			const response = handleInitialize(request);

			expect(response.jsonrpc).toBe("2.0");
			expect(response.id).toBe(1);
			expect(response.result).toBeDefined();
			const result = response.result as {
				protocolVersion: string;
				serverInfo: { name: string; version: string };
			};
			expect(result.protocolVersion).toBe("2024-11-05");
			expect(result.serverInfo.name).toBe("singularity-mcp");
		});
	});

	describe("tools/list", () => {
		test("returns all exposed tools", () => {
			const request: JsonRpcRequest = {
				jsonrpc: "2.0",
				id: 2,
				method: "tools/list",
			};

			const response = handleToolsList(request);

			expect(response.jsonrpc).toBe("2.0");
			expect(response.id).toBe(2);
			const result = response.result as { tools: Array<{ name: string }> };
			expect(result.tools.length).toBeGreaterThan(0);
			const toolNames = result.tools.map((t) => t.name);
			expect(toolNames).toContain("memory.facts");
			expect(toolNames).toContain("memory.sessions");
			expect(toolNames).toContain("skills.list");
			expect(toolNames).toContain("skills.enable");
			expect(toolNames).toContain("skills.disable");
			expect(toolNames).toContain("scheduler.jobs.list");
			expect(toolNames).toContain("scheduler.jobs.create");
			expect(toolNames).toContain("approvals.request");
			expect(toolNames).toContain("approvals.resolve");
		});
	});

	describe("tools/call", () => {
		test("memory.facts returns empty array when no facts", async () => {
			const request: JsonRpcRequest = {
				jsonrpc: "2.0",
				id: 3,
				method: "tools/call",
				params: {
					name: "memory.facts",
					arguments: { subject: "test" },
				},
			};

			const response = await handleToolsCall(request);

			expect(response.jsonrpc).toBe("2.0");
			expect(response.id).toBe(3);
			const result = response.result as {
				content: Array<{ type: string; text: string }>;
			};
			expect(result.content[0].type).toBe("text");
			const parsed = JSON.parse(result.content[0].text);
			expect(Array.isArray(parsed)).toBe(true);
			expect(parsed.length).toBe(0);
		});

		test("memory.sessions returns empty array when no sessions", async () => {
			const request: JsonRpcRequest = {
				jsonrpc: "2.0",
				id: 4,
				method: "tools/call",
				params: {
					name: "memory.sessions",
					arguments: { query: "test" },
				},
			};

			const response = await handleToolsCall(request);

			expect(response.jsonrpc).toBe("2.0");
			expect(response.id).toBe(4);
			const result = response.result as {
				content: Array<{ type: string; text: string }>;
			};
			expect(result.content[0].type).toBe("text");
			const parsed = JSON.parse(result.content[0].text);
			expect(Array.isArray(parsed)).toBe(true);
			expect(parsed.length).toBe(0);
		});

		test("skills.list returns empty array initially", async () => {
			const request: JsonRpcRequest = {
				jsonrpc: "2.0",
				id: 5,
				method: "tools/call",
				params: {
					name: "skills.list",
					arguments: {},
				},
			};

			const response = await handleToolsCall(request);

			expect(response.jsonrpc).toBe("2.0");
			expect(response.id).toBe(5);
			const result = response.result as {
				content: Array<{ type: string; text: string }>;
			};
			const parsed = JSON.parse(result.content[0].text);
			expect(Array.isArray(parsed)).toBe(true);
			expect(parsed.length).toBe(0);
		});

		test("scheduler.jobs.list returns empty array", async () => {
			const request: JsonRpcRequest = {
				jsonrpc: "2.0",
				id: 6,
				method: "tools/call",
				params: {
					name: "scheduler.jobs.list",
					arguments: {},
				},
			};

			const response = await handleToolsCall(request);

			expect(response.jsonrpc).toBe("2.0");
			expect(response.id).toBe(6);
			const result = response.result as {
				content: Array<{ type: string; text: string }>;
			};
			const parsed = JSON.parse(result.content[0].text);
			expect(Array.isArray(parsed)).toBe(true);
			expect(parsed.length).toBe(0);
		});

		test("returns error for unknown tool", async () => {
			const request: JsonRpcRequest = {
				jsonrpc: "2.0",
				id: 7,
				method: "tools/call",
				params: {
					name: "unknown.tool",
					arguments: {},
				},
			};

			const response = await handleToolsCall(request);

			expect(response.jsonrpc).toBe("2.0");
			expect(response.id).toBe(7);
			const result = response.result as {
				content: Array<{ type: string; text: string; isError?: boolean }>;
			};
			expect(result.content[0].type).toBe("text");
			expect(result.content[0].text).toContain("Unknown tool");
		});
	});

	describe("resources/list", () => {
		test("returns empty resources list", () => {
			const request: JsonRpcRequest = {
				jsonrpc: "2.0",
				id: 8,
				method: "resources/list",
			};

			const response = handleResourcesList(request);

			expect(response.jsonrpc).toBe("2.0");
			expect(response.id).toBe(8);
			const result = response.result as { resources: unknown[] };
			expect(result.resources.length).toBe(0);
		});
	});

	describe("prompts/list", () => {
		test("returns empty prompts list", () => {
			const request: JsonRpcRequest = {
				jsonrpc: "2.0",
				id: 9,
				method: "prompts/list",
			};

			const response = handlePromptsList(request);

			expect(response.jsonrpc).toBe("2.0");
			expect(response.id).toBe(9);
			const result = response.result as { prompts: unknown[] };
			expect(result.prompts.length).toBe(0);
		});
	});

	describe("shutdown", () => {
		test("returns shutdown confirmation", () => {
			const request: JsonRpcRequest = {
				jsonrpc: "2.0",
				id: 10,
				method: "shutdown",
			};

			const response = handleShutdown(request);

			expect(response.jsonrpc).toBe("2.0");
			expect(response.id).toBe(10);
			const result = response.result as { shutdown: boolean };
			expect(result.shutdown).toBe(true);
		});
	});
});

describe("MCP JSON-RPC protocol", () => {
	test("request parsing works correctly", () => {
		const rawRequest = JSON.stringify({
			jsonrpc: "2.0",
			id: 1,
			method: "initialize",
			params: {
				protocolVersion: "2024-11-05",
				capabilities: {},
				clientInfo: { name: "test", version: "1.0.0" },
			},
		});

		const parsed = JSON.parse(rawRequest);
		expect(parsed.jsonrpc).toBe("2.0");
		expect(parsed.method).toBe("initialize");
		expect(parsed.params.clientInfo.name).toBe("test");
	});

	test("response serialization works correctly", () => {
		const response: JsonRpcResponse = {
			jsonrpc: "2.0",
			id: 1,
			result: {
				protocolVersion: "2024-11-05",
				capabilities: {},
				serverInfo: { name: "singularity-mcp", version: "0.1.0" },
			},
		};

		const serialized = JSON.stringify(response);
		const parsed = JSON.parse(serialized);

		expect(parsed.jsonrpc).toBe("2.0");
		expect(parsed.id).toBe(1);
		expect(parsed.result.protocolVersion).toBe("2024-11-05");
	});
});
