import type { Database } from "bun:sqlite";
import {
	FactStore,
	SchedulerStore,
	SessionStore,
	SkillRegistry,
	SqliteApprovalAuditLog,
} from "singularity-core";
import type {
	JsonRpcRequest,
	JsonRpcResponse,
	Tool,
	ToolCallParams,
	ToolCallResult,
	ToolListResult,
} from "../protocol.ts";

// Database reference for stores
let db: Database | null = null;
let factStore: FactStore | null = null;
let sessionStore: SessionStore | null = null;
let skillRegistry: SkillRegistry | null = null;
let schedulerStore: SchedulerStore | null = null;
let approvalAuditLog: SqliteApprovalAuditLog | null = null;

export function initializeStores(database: Database) {
	db = database;
	factStore = new FactStore(db);
	sessionStore = new SessionStore(db);
	skillRegistry = new SkillRegistry();
	schedulerStore = new SchedulerStore(db);
	approvalAuditLog = new SqliteApprovalAuditLog(db);
}

// MCP tool definitions exposed by this server
function getToolDefinitions(): Tool[] {
	return [
		{
			name: "memory.facts",
			description: "Recall facts from FactStore",
			inputSchema: {
				type: "object",
				properties: {
					subject: { type: "string", description: "Fact subject to recall" },
					predicate: {
						type: "string",
						description: "Fact predicate to filter by",
					},
					limit: { type: "number", description: "Max results (default 10)" },
					minConfidence: {
						type: "number",
						description: "Min confidence 0.0-1.0 (default 0.6)",
					},
				},
			},
		},
		{
			name: "memory.sessions",
			description: "Search sessions from SessionStore",
			inputSchema: {
				type: "object",
				properties: {
					query: {
						type: "string",
						description: "Search query for label/summary",
					},
					runtime: {
						type: "string",
						description: "Filter by runtime (e.g. 'opencode')",
					},
					limit: { type: "number", description: "Max results (default 10)" },
				},
			},
		},
		{
			name: "skills.list",
			description: "List available skills from SkillRegistry",
			inputSchema: {
				type: "object",
				properties: {
					includeHidden: {
						type: "boolean",
						description: "Include pending/denied skills",
					},
				},
			},
		},
		{
			name: "skills.enable",
			description: "Enable a skill in SkillRegistry",
			inputSchema: {
				type: "object",
				properties: {
					name: { type: "string", description: "Skill name to enable" },
				},
				required: ["name"],
			},
		},
		{
			name: "skills.disable",
			description: "Disable a skill in SkillRegistry",
			inputSchema: {
				type: "object",
				properties: {
					name: { type: "string", description: "Skill name to disable" },
				},
				required: ["name"],
			},
		},
		{
			name: "scheduler.jobs.list",
			description: "List scheduled jobs from SchedulerStore",
			inputSchema: {
				type: "object",
				properties: {
					profileId: { type: "string", description: "Filter by profile ID" },
				},
			},
		},
		{
			name: "scheduler.jobs.create",
			description: "Create a scheduled job in SchedulerStore",
			inputSchema: {
				type: "object",
				properties: {
					profileId: { type: "string", description: "Profile ID" },
					name: { type: "string", description: "Job name" },
					schedule: { type: "string", description: "Cron schedule expression" },
					prompt: { type: "string", description: "Job prompt" },
					enabled: { type: "boolean", description: "Whether job is enabled" },
				},
				required: ["profileId", "name", "schedule", "prompt"],
			},
		},
		{
			name: "approvals.request",
			description: "Create an approval request",
			inputSchema: {
				type: "object",
				properties: {
					sessionId: { type: "string", description: "Session ID" },
					action: { type: "string", description: "Action to approve" },
					resource: { type: "string", description: "Resource affected" },
					effectRequested: {
						type: "string",
						description: "Effect being requested",
					},
					decidedBy: { type: "string", description: "Who is deciding" },
					reason: { type: "string", description: "Reason for request" },
				},
				required: ["sessionId", "action", "effectRequested", "decidedBy"],
			},
		},
		{
			name: "approvals.resolve",
			description: "Resolve an approval request",
			inputSchema: {
				type: "object",
				properties: {
					id: { type: "string", description: "Approval ID" },
					decision: {
						type: "string",
						enum: ["allow", "deny"],
						description: "Decision",
					},
					decidedBy: { type: "string", description: "Who decided" },
					reason: { type: "string", description: "Reason for decision" },
				},
				required: ["id", "decision", "decidedBy"],
			},
		},
	];
}

export function handleToolsList(_request: JsonRpcRequest): JsonRpcResponse {
	const tools = getToolDefinitions();

	const result: ToolListResult = { tools };

	return {
		jsonrpc: "2.0",
		id: _request.id,
		result,
	};
}

export async function handleToolsCall(
	request: JsonRpcRequest,
): Promise<JsonRpcResponse> {
	const rawParams = request.params as Record<string, unknown> | undefined;
	if (!rawParams || typeof rawParams.name !== "string") {
		return {
			jsonrpc: "2.0",
			id: request.id,
			result: {
				content: [
					{ type: "text", text: "Error: missing or invalid tool name" },
				],
				isError: true,
			},
		};
	}

	const params = rawParams as unknown as ToolCallParams;
	const { name, arguments: args = {} } = params;

	try {
		let result: ToolCallResult;

		switch (name) {
			case "memory.facts": {
				if (!factStore) {
					throw new Error("FactStore not initialized");
				}
				const facts = factStore.recall(
					args.subject as string | undefined,
					args.predicate as string | undefined,
					{
						limit: args.limit as number | undefined,
						minConfidence: args.minConfidence as number | undefined,
					},
				);
				result = {
					content: [{ type: "text", text: JSON.stringify(facts, null, 2) }],
				};
				break;
			}

			case "memory.sessions": {
				if (!sessionStore) {
					throw new Error("SessionStore not initialized");
				}
				const sessions = sessionStore.searchDigests({
					query: args.query as string | undefined,
					runtime: args.runtime as string | undefined,
					limit: args.limit as number | undefined,
				});
				result = {
					content: [{ type: "text", text: JSON.stringify(sessions, null, 2) }],
				};
				break;
			}

			case "skills.list": {
				if (!skillRegistry) {
					throw new Error("SkillRegistry not initialized");
				}
				const skills = skillRegistry.list({
					includeHidden: args.includeHidden as boolean | undefined,
				});
				result = {
					content: [{ type: "text", text: JSON.stringify(skills, null, 2) }],
				};
				break;
			}

			case "skills.enable": {
				if (!skillRegistry) {
					throw new Error("SkillRegistry not initialized");
				}
				skillRegistry.setStatus(args.name as string, "active");
				result = {
					content: [{ type: "text", text: `Skill "${args.name}" enabled` }],
				};
				break;
			}

			case "skills.disable": {
				if (!skillRegistry) {
					throw new Error("SkillRegistry not initialized");
				}
				skillRegistry.setStatus(args.name as string, "denied");
				result = {
					content: [{ type: "text", text: `Skill "${args.name}" disabled` }],
				};
				break;
			}

			case "scheduler.jobs.list": {
				if (!schedulerStore) {
					throw new Error("SchedulerStore not initialized");
				}
				const profileId = args.profileId as string | undefined;
				const jobs = profileId
					? schedulerStore.listByProfile(profileId)
					: schedulerStore.listEnabled();
				result = {
					content: [{ type: "text", text: JSON.stringify(jobs, null, 2) }],
				};
				break;
			}

			case "scheduler.jobs.create": {
				if (!schedulerStore) {
					throw new Error("SchedulerStore not initialized");
				}
				const job = schedulerStore.create({
					profileId: args.profileId as string,
					name: args.name as string,
					schedule: args.schedule as string,
					prompt: args.prompt as string,
					enabled: args.enabled as boolean | undefined,
				});
				result = {
					content: [{ type: "text", text: JSON.stringify(job, null, 2) }],
				};
				break;
			}

			case "approvals.request": {
				if (!approvalAuditLog) {
					throw new Error("ApprovalAuditLog not initialized");
				}
				const entry = {
					id: `apr_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 9)}`,
					sessionId: args.sessionId as string,
					action: args.action as string,
					resource: args.resource as string | undefined,
					effectRequested: args.effectRequested as string,
					decision: "ask" as const,
					decidedBy: args.decidedBy as string,
					decidedAt: new Date(),
					saveRule: "once" as const,
					reason: (args.reason as string | undefined) ?? "",
				};
				await approvalAuditLog.record(entry);
				result = {
					content: [{ type: "text", text: JSON.stringify(entry, null, 2) }],
				};
				break;
			}

			case "approvals.resolve": {
				if (!approvalAuditLog) {
					throw new Error("ApprovalAuditLog not initialized");
				}
				const id = args.id as string;
				const decision = args.decision as "allow" | "deny";
				const decidedBy = args.decidedBy as string;
				const reason = (args.reason as string | undefined) ?? "";

				const existing = await approvalAuditLog.getById(id);
				if (!existing) {
					throw new Error(`Approval ${id} not found`);
				}

				const updated = {
					...existing,
					decision,
					decidedBy,
					reason,
					decidedAt: new Date(),
				};
				await approvalAuditLog.record(updated);
				result = {
					content: [{ type: "text", text: JSON.stringify(updated, null, 2) }],
				};
				break;
			}

			default:
				throw new Error(`Unknown tool: ${name}`);
		}

		return {
			jsonrpc: "2.0",
			id: request.id,
			result,
		};
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error(`[singularity-mcp] Tool error: ${message}`);

		return {
			jsonrpc: "2.0",
			id: request.id,
			result: {
				content: [{ type: "text", text: `Error: ${message}` }],
				isError: true,
			},
		};
	}
}
