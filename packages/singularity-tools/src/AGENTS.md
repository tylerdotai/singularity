# singularity-tools

Tool executor package. Provides the `Tool` factory, `ToolRegistry`, and 7 built-in tools with risk scores. No Effect dependency.

## What this package does

- `ToolDef` / `ToolContext` / `ToolResult` / `Settlement` type definitions
- `Tool.make()` factory for authoring tools with metadata and risk scores
- `ToolRegistry` class for registering and materializing tools
- 7 built-in tools with risk scores: `Read`, `Edit`, `Bash`, `Grep`, `Glob`, `WebFetch`, `WebSearch`
- No actual tool execution in the types/skeleton phase

## Types

All types are exported from `src/types.ts`:
- `ToolDef` — a defined tool with metadata
- `ToolRiskScore` — `"LOW" | "MEDIUM" | "HIGH" | "CRITICAL"`
- `ToolInput` / `ToolOutput` — raw unvalidated input/output
- `ToolContext` — runtime context passed to every tool execution
- `ToolResult` / `ToolResultValue` — structured result value
- `Settlement` — full settlement pipeline result
- `ToolRegistryInterface` / `Materialization` / `ToolDefinition`

## Errors

All errors are exported from `src/errors.ts`:
- `ToolValidationError` — validation failure
- `ToolExecutionError` — execution failure
- `ToolNotFoundError` — tool not found in registry

## What this package does NOT do

- No Effect imports
- No actual tool execution (skeleton phase only)
- No tool permission enforcement
