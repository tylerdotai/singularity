import type {
	JsonRpcRequest,
	JsonRpcResponse,
	Resource,
	ResourceListResult,
} from "../protocol.ts";

// Resources are read-only in this implementation
// Future: expose memory facts/sessions as resources

export function handleResourcesList(_request: JsonRpcRequest): JsonRpcResponse {
	// No resources exposed yet - future phases may expose facts/sessions as resources
	const result: ResourceListResult = { resources: [] };

	return {
		jsonrpc: "2.0",
		id: _request.id,
		result,
	};
}
