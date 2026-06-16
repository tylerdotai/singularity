import type { JsonRpcRequest, JsonRpcResponse } from "../protocol.ts";

export function handleShutdown(_request: JsonRpcRequest): JsonRpcResponse {
	console.error("[singularity-mcp] Shutdown requested");

	return {
		jsonrpc: "2.0",
		id: _request.id,
		result: { shutdown: true },
	};
}
