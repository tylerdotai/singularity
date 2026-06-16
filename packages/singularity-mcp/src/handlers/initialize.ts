import type {
	InitializeParams,
	InitializeResult,
	JsonRpcRequest,
	JsonRpcResponse,
	ServerCapabilities,
} from "../protocol.ts";
import { MCP_PROTOCOL_VERSION } from "../protocol.ts";

const SERVER_INFO = {
	name: "singularity-mcp",
	version: "0.1.0",
};

const SERVER_CAPABILITIES: ServerCapabilities = {
	tools: {},
	resources: {},
	prompts: {},
};

export function handleInitialize(request: JsonRpcRequest): JsonRpcResponse {
	const params = request.params as InitializeParams | undefined;

	const result: InitializeResult = {
		protocolVersion: MCP_PROTOCOL_VERSION,
		capabilities: SERVER_CAPABILITIES,
		serverInfo: SERVER_INFO,
	};

	// Log the initialization
	console.error(
		`[singularity-mcp] Initialized by client: ${params?.clientInfo?.name ?? "unknown"} v${params?.clientInfo?.version ?? "?"}`,
	);

	return {
		jsonrpc: "2.0",
		id: request.id,
		result,
	};
}
