// MCP Protocol Types — JSON-RPC 2.0 based
// Spec version: 2024-11-05

export const MCP_PROTOCOL_VERSION = "2024-11-05";

// ---------- JSON-RPC 2.0 Base ----------

export interface JsonRpcRequest {
	jsonrpc: "2.0";
	id: number | string;
	method: string;
	params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
	jsonrpc: "2.0";
	id: number | string;
	result?: unknown;
}

export interface JsonRpcError {
	jsonrpc: "2.0";
	id: number | string;
	error: {
		code: number;
		message: string;
		data?: unknown;
	};
}

export type JsonRpcResponseOrError = JsonRpcResponse | JsonRpcError;

export interface JsonRpcNotification {
	jsonrpc: "2.0";
	method: string;
	params?: Record<string, unknown>;
}

// ---------- Error Codes ----------

export enum JsonRpcErrorCode {
	ParseError = -32700,
	InvalidRequest = -32600,
	MethodNotFound = -32601,
	InvalidParams = -32602,
	InternalError = -32603,
}

// ---------- MCP Capabilities ----------

export interface ServerCapabilities {
	tools?: {
		readonly listChanged?: boolean;
	};
	resources?: {
		readonly subscribe?: boolean;
		readonly listChanged?: boolean;
	};
	prompts?: {
		readonly listChanged?: boolean;
	};
}

export interface ClientCapabilities {
	tools?: {
		readonly listChanged?: boolean;
	};
	resources?: {
		readonly subscribe?: boolean;
	};
	prompts?: {
		readonly listChanged?: boolean;
	};
}

// ---------- Initialize ----------

export interface InitializeParams {
	protocolVersion?: string;
	capabilities: ClientCapabilities;
	clientInfo: {
		name: string;
		version: string;
	};
}

export interface InitializeResult {
	protocolVersion: string;
	capabilities: ServerCapabilities;
	serverInfo: {
		name: string;
		version: string;
	};
}

// ---------- Tools ----------

export interface Tool {
	name: string;
	description?: string;
	inputSchema: unknown;
	outputSchema?: unknown;
}

export interface ToolListParams {
	readonly _?: unknown;
}

export interface ToolListResult {
	tools: Tool[];
}

export interface ToolCallParams {
	name: string;
	arguments?: Record<string, unknown>;
}

export interface ToolCallResult {
	content: Array<
		| { type: "text"; text: string }
		| { type: "image"; data: string; mimeType: string }
		| { type: "resource"; resource: { uri: string; mimeType?: string } }
	>;
	isError?: boolean;
}

// ---------- Resources ----------

export interface Resource {
	uri: string;
	name: string;
	description?: string;
	mimeType?: string;
}

export interface ResourceListResult {
	resources: Resource[];
}

export interface ResourceTemplatesResult {
	templates: Resource[];
}

// ---------- Prompts ----------

export interface Prompt {
	name: string;
	description?: string;
	arguments?: Array<{
		name: string;
		description?: string;
		required?: boolean;
	}>;
}

export interface PromptListResult {
	prompts: Prompt[];
}

export interface PromptGetParams {
	name: string;
	arguments?: Record<string, string>;
}

export interface PromptGetResult {
	essages: Array<{
		role: "user" | "assistant";
		content:
			| { type: "text"; text: string }
			| { type: "image"; data: string; mimeType: string };
	}>;
}

// ---------- Server ----------

export interface ServerInfo {
	name: string;
	version: string;
}
