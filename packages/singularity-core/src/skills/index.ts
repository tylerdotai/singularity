// Phase 3.3 / Phase 11 — skills subsystem barrel.
//
// Public surface of `singularity-core/skills`:
//   - schema: `Skill` interface + `SkillStatus` / `SkillScope` /
//     `SkillSource` / `SkillProvenance` / `SkillPolicy` / `SkillFilter`
//   - registry: `SkillRegistry` class (in-memory metadata wrapper;
//     `pending` skills hidden from default `list()`)
//   - validator: `SkillValidator` class + `ValidationResult` /
//     `ValidationIssue` / `ValidateOptions` + `posixNormalize` helper
//     (Phase 3.2)
//   - draft: `SkillDraftCreator` class + `DraftContext` / `DraftResult`
//     (Phase 3.3 — deterministic template, no LLM)
//   - agent-author: `AgentSkillAuthor` class + `AgentSkillAuthorInput` /
//     `AgentSkillDraftResult` (Phase 11 — LLM-based drafting)
//   - agent-author-registry: `SkillAuthoringPipeline` class
//     (Phase 11 — draft + register pipeline)

export {
  AgentSkillAuthor,
  type AgentSkillAuthorInput,
  type AgentSkillAuthorOptions,
  type AgentSkillDraftResult,
} from './agent-author.js';
export { SkillAuthoringPipeline } from './agent-author-registry.js';
export * from './draft.js';
export * from './registry.js';
export * from './schema.js';
export * from './validator.js';
