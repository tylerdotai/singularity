import type {
	JsonRpcRequest,
	JsonRpcResponse,
	Prompt,
	PromptListResult,
} from "../protocol.ts";

// No prompts exposed in this implementation
// Future: expose prompt templates

export function handlePromptsList(_request: JsonRpcRequest): JsonRpcResponse {
	const result: PromptListResult = { prompts: [] };

	return {
		jsonrpc: "2.0",
		id: _request.id,
		result,
	};
}
