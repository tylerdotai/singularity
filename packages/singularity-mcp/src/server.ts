import { Database } from "bun:sqlite";
import { handleInitialize } from "./handlers/initialize.ts";
import { handlePromptsList } from "./handlers/prompts.ts";
import { handleResourcesList } from "./handlers/resources.ts";
import { handleShutdown } from "./handlers/shutdown.ts";
import {
	handleToolsCall,
	handleToolsList,
	initializeStores,
} from "./handlers/tools.ts";
import type {
	JsonRpcError,
	JsonRpcRequest,
	JsonRpcResponse,
	JsonRpcResponseOrError,
} from "./protocol.ts";
import { JsonRpcErrorCode } from "./protocol.ts";

function logError(message: string): void {
	console.error(`[singularity-mcp] ${message}`);
}

function writeResponse(response: JsonRpcResponseOrError): void {
	stdout.write(`${JSON.stringify(response)}\n`);
}

function createErrorResponse(
	id: number | string | undefined,
	code: JsonRpcErrorCode,
	message: string,
): JsonRpcError {
	return {
		jsonrpc: "2.0",
		id: id ?? 0,
		error: {
			code,
			message,
		},
	};
}

async function handleRequest(request: JsonRpcRequest): Promise<void> {
	const { method, id } = request;

	try {
		let response: JsonRpcResponse;

		switch (method) {
			case "initialize":
				response = handleInitialize(request);
				break;

			case "tools/list":
				response = handleToolsList(request);
				break;

			case "tools/call":
				response = await handleToolsCall(request);
				break;

			case "resources/list":
				response = handleResourcesList(request);
				break;

			case "prompts/list":
				response = handlePromptsList(request);
				break;

			case "shutdown":
				response = handleShutdown(request);
				break;

			default:
				logError(`Unknown method: ${method}`);
				writeResponse(
					createErrorResponse(
						id,
						JsonRpcErrorCode.MethodNotFound,
						`Method not found: ${method}`,
					),
				);
				return;
		}

		writeResponse(response);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		logError(`Error handling ${method}: ${message}`);
		writeResponse(
			createErrorResponse(id, JsonRpcErrorCode.InternalError, message),
		);
	}
}

function parseRequests(data: string): JsonRpcRequest[] {
	const requests: JsonRpcRequest[] = [];
	const lines = data.split("\n");

	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed) continue;

		try {
			const parsed = JSON.parse(trimmed);
			if (parsed.jsonrpc === "2.0" && parsed.method) {
				requests.push(parsed as JsonRpcRequest);
			}
		} catch {
			// Skip non-JSON lines
		}
	}

	return requests;
}

async function main(): Promise<void> {
	// Initialize database for stores
	const dbPath = process.env.SINGULARITY_DB_PATH ?? ":memory:";
	const db = new Database(dbPath);
	initializeStores(db);

	logError("Singularity MCP server starting...");

	// Read all input from stdin
	const stdinText = await Bun.stdin.text();
	const requests = parseRequests(stdinText);

	// Handle all requests
	for (const request of requests) {
		await handleRequest(request);
	}
}

main().catch((err) => {
	logError(`Fatal error: ${err}`);
	process.exit(1);
});
