// Singularity configuration schema and validation
// Re-export all public types from sub-modules here

export { InterpolationError, interpolate } from "./interpolation.js";
export {
	ConfigSchema,
	type ConfigSchemaType,
	defaultConfig,
} from "./schema.js";
export { type ConfigStore, configStore } from "./store.js";
export { type ValidationResult, validateStartup } from "./validation.js";
