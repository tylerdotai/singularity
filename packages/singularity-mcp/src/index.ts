// Re-exports for singularity-mcp package

export { handleInitialize } from "./handlers/initialize.js";
export { handlePromptsList } from "./handlers/prompts.js";
export { handleResourcesList } from "./handlers/resources.js";
export { handleShutdown } from "./handlers/shutdown.js";
export {
	handleToolsCall,
	handleToolsList,
	initializeStores,
} from "./handlers/tools.js";
export * from "./protocol.js";
