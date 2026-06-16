# Singularity Architecture

## Architecture Decision

Fork OpenCode and keep the OpenCode stack.

OpenCode is already close to the required foundation: TypeScript, Bun, TUI/CLI, local server, SQLite persistence, provider abstraction, permissions, plugins, skills, and worktree/workspace concepts.

Pi remains a reference for extension ergonomics, SDK/RPC mode, project trust, session trees, and minimal context design.

Hermes remains the reference for self-learning, profiles, gateway, cron, memory, skills, and session search.

## System Shape

```text
┌──────────────────────────────────────────────────────────────┐
│                         Surfaces                             │
│  CLI/TUI  │  Telegram  │  Discord  │  Web Dashboard  │ API   │
└────┬──────┴─────┬──────┴────┬──────┴────────┬────────┴──────┘
     │            │           │               │
┌────▼────────────▼───────────▼───────────────▼────────────────┐
│                    Singularity Control Plane                  │
│  sessions │ approvals │ profiles │ scheduler │ gateway router │
└────┬─────────────────────────────────────────────────────────┘
      │
┌────▼─────────────────────────────────────────────────────────┐
│                      Agent Runtime                            │
│  model router │ prompt builder │ memory injector │            │
│  skill loader │ subagent runner │ context compressor           │
└────┬─────────────────────────────────────────────────────────┘
      │
┌────▼─────────────────────────────────────────────────────────┐
│                   singularity-engine                           │
│  turn execution │ compaction │ persistence                    │
└────┬─────────────────────────────────────────────────────────┘
      │
┌────▼─────────────────────────────────────────────────────────┐
│                     singularity-llm                            │
│  provider-neutral LLM client │ OpenAI adapter │ Anthropic   │
└────┬─────────────────────────────────────────────────────────┘
      │
┌────▼─────────────────────────────────────────────────────────┐
│                     Capability Layer                          │
│ tools │ singularity-tools │ plugins │ MCP │ skills │ worktrees │
│ sandboxes │ web                                           │
└────┬─────────────────────────────────────────────────────────┘
     │
┌────▼─────────────────────────────────────────────────────────┐
│                         Storage                               │
│ SQLite: sessions, events, tools, approvals, facts, skills,    │
│ profiles, configs, providers, costs, scheduler, gateways      │
└──────────────────────────────────────────────────────────────┘
```

## Packages

Packages in this repository:

- `packages/singularity-core` — memory, facts, skills, profiles, scheduler, approval policy
- `packages/singularity-gateway` — Telegram and Discord adapters
- `packages/singularity-dashboard` — web dashboard API and UI
- `packages/singularity-cli` — singularity binary and TUI panels
- `packages/singularity-approvals` — grant vault and multi-channel authorization
- `packages/singularity-loop` — evaluator gates and quality loops
- `packages/singularity-llm` — provider-neutral LLM client with OpenAI + Anthropic adapters
- `packages/singularity-tools` — tool executor with Tool.make(), ToolRegistry, and 7 built-in tools
- `packages/singularity-engine` — agent session runner with turn execution, compaction, and persistence
- `packages/singularity-mcp` — MCP server with JSON-RPC 2.0 stdio
- `packages/singularity-config` — config schema/store/validation/interpolation
- `packages/singularity-providers` — provider registry with 10 provider profiles

OpenCode's existing packages remain intact. Singularity packages are added at the edge. Core patches only when no extension point exists.

## Storage Architecture

Use one SQLite database per profile by default:

- `~/.singularity/profiles/default/state.db`
- project-local override allowed later: `.singularity/state.db`

Storage principles:

- WAL where filesystem supports WAL.
- Fallback journal mode for hostile filesystems.
- Migrations versioned and repeatable.
- FTS5 for sessions and facts.
- Optional vector index adapter.
- No secrets in normal tables.
- Credential references point to encrypted credential store.

## Minimal Schema

### profiles

- id
- name
- root_path
- created_at
- updated_at
- default_agent_id

### agents

- id
- profile_id
- name
- system_prompt
- model_policy_json
- tool_policy_json
- memory_scope_json
- created_at
- updated_at

### sessions

- id
- profile_id
- agent_id
- project_id
- parent_session_id
- source
- title
- status
- started_at
- ended_at
- model_config_json
- metadata_json

### messages

- id
- session_id
- role
- content
- created_at
- token_count
- metadata_json

### message_parts

- id
- message_id
- type
- content_json
- created_at

### tool_calls

- id
- session_id
- message_id
- tool_name
- input_json
- output_json
- status
- started_at
- ended_at
- risk_score
- approval_id
- error

### approvals

- id
- session_id
- action
- resource
- effect_requested
- decision
- decided_by
- decided_at
- save_rule
- metadata_json

### facts

- id
- profile_id
- scope
- subject
- predicate
- value
- kind
- confidence
- source_session_id
- source_message_id
- source_quote
- superseded_by
- created_at
- updated_at

### skills

- id
- profile_id
- scope
- name
- path
- description
- version
- status
- source
- provenance_json
- created_at
- updated_at

### skill_events

- id
- skill_id
- session_id
- event_type
- notes
- created_at

### scheduler_jobs

- id
- profile_id
- name
- schedule
- prompt
- enabled
- delivery_target
- toolsets_json
- model_policy_json
- created_at
- updated_at

### gateway_channels

- id
- profile_id
- platform
- external_id
- thread_id
- name
- role
- created_at
- updated_at

## Memory Architecture

Singularity memory should be NLM-compatible from day one.

Preferred direction:

- Ship `pbmagnet4/nlm-memory` as the bundled memory subsystem or port its schema/service boundaries directly into `packages/singularity-core` after integration spike.
- Keep NLM's Apache-2.0 license compatibility documented.
- Preserve NLM tool semantics: `recall_sessions`, `get_session`, `recall_facts`, `get_fact_history`, `cite_session`, and `mark_superseded`.
- Preserve NLM's session/fact separation, source quotes, confidence, corroboration counts, and supersedence chains.
- Add Singularity-specific joins for profiles, agents, skills, approvals, gateway channels, and worktrees.

Singularity memory has four layers:

1. Session memory: transcript, tool calls, traces, costs, platform source, worktree metadata.
2. Fact memory: declarative statements with source quotes and supersedence.
3. Skill memory: procedural playbooks, scripts, templates, and verification steps.
4. Signal memory: local quality-gate/test/review events aggregated into repo/model failure modes.

Retrieval flow:

1. Classify user request: current-task, fact lookup, session recall, skill needed, or fresh task.
2. Retrieve facts by subject/predicate when exact enough.
3. Retrieve session digests for history/context questions.
4. Load full session only when digest is insufficient.
5. Load skills only when relevant.
6. Inject compact memory context into prompt with citations.

## Skill Creation Loop

Trigger candidates:

- Complex task with 5+ tool calls.
- New reusable workflow discovered.
- User correction of procedure.
- Skill failed and required workaround.
- Repeated pattern across sessions.

Flow:

1. Summarize reusable procedure.
2. Draft skill as Markdown.
3. Attach scripts/templates only when necessary.
4. Run lint/validator.
5. Save as `pending_review` by default.
6. User or admin approves activation.
7. Usage tracking starts after activation.

## Approval Policy

Singularity should combine OpenCode's rule model and Hermes-style safety classes.

Decision values:

- allow
- ask
- deny

Policy dimensions:

- action: shell, file_write, file_delete, network, external_message, social_post, billing, invite, credential, database_mutation
- resource: path, host, platform, repo, project, profile
- scope: global, profile, project, agent, session
- source: cli, tui, telegram, discord, dashboard, scheduler

Defaults:

- Read-only local operations: allow.
- File writes inside workspace: ask first until project trusted; then smart policy.
- Shell commands: ask for risky commands; allow safe commands by policy.
- Deletion: ask; implementation must prefer trash.
- External mutation: ask every time.
- Secrets access: deny unless explicit tool and scope.
- Production mutation: ask every time.
- Scheduler external action: deny unless job policy explicitly allows.

## Work Isolation

Code work default:

1. Detect git repository.
2. Create git worktree from current branch.
3. Run agent in worktree.
4. Store worktree metadata in session.
5. Return diff summary and verification output.
6. Merge/commit only on explicit request.

Non-git fallback:

- Ask for local direct edit or copy sandbox.
- Never silently mutate an unknown folder for multi-agent work.

## Gateway Architecture

Gateway is a transport layer over the same session core.

Telegram and Discord adapters must provide:

- message receive
- message send
- thread/topic mapping
- file/media attachment ingestion
- approval reply mapping
- platform command mapping
- channel authorization
- rate limiting
- session source tagging

Gateway must not fork a separate agent loop.

## Dashboard Architecture

Dashboard is an admin/control surface, not a separate product core.

Initial dashboard APIs:

- sessions search/read
- tool trace read
- pending approvals
- facts list/edit/supersede
- skills list/review/activate
- gateway channel status
- scheduler jobs
- provider config summary

## Plugin Compatibility

Support layers:

1. Native Singularity plugins.
2. OpenCode plugins unchanged where safe.
3. Oh My Opencode compatibility wrapper.
4. Pi-style extension concepts as future SDK inspiration.

All third-party plugins run under:

- install provenance
- permission manifest
- approval policy
- capability sandbox where possible
- explicit user enablement

## Implementation Rule

Build Singularity at the edge first. Patch fork core only for stable hooks, schema integration, or missing extension points.
