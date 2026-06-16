# Singularity Product Specification

## Position

Singularity is a provider-neutral, local-first agent harness built as a product from day one.

Singularity starts with CLI/TUI because agent work must be fast, inspectable, scriptable, and developer-native. Telegram, Discord, and web dashboard come next as first-class surfaces over the same core, not separate bots.

## Fork Base

Base: OpenCode fork.

Stack: keep fork stack unless a subsystem forces a separate service.

Default runtime:

- TypeScript
- Bun
- SQLite
- Drizzle where OpenCode already uses it
- OpenCode TUI/CLI and local server as the initial shell
- Plugin architecture compatible with OpenCode and practical Oh My Opencode patterns

Python is allowed for migration tooling or optional adapters only when using existing Hermes code as reference. Do not split the product into TypeScript plus Python core unless a hard technical reason appears.

## Product Goals

1. Provider-neutral agent harness.
2. CLI/TUI-first user experience.
3. SQLite-backed session, memory, fact, tool-call, and audit store.
4. Hermes-style self-learning loop.
5. NLM-compatible fact memory with supersedence/history, preferably via bundled `pbmagnet4/nlm-memory` integration.
6. Automatic skill creation and skill updates from successful complex work.
7. Telegram and Discord gateway as day-one product requirement after CLI/TUI foundation.
8. Web dashboard after messaging gateway.
9. Work isolation by default for code tasks.
10. Subagents and profiles as first-class concepts.
11. Product-grade approval, security, redaction, and audit logs.
12. Oh My Opencode plugin compatibility where safe.
13. Local-first defaults with optional sync later.

## Non-Goals

- No single-user toy MVP architecture.
- No hard dependency on one model provider.
- No product-critical dependency on sqlite-memory until license review clears redistribution and commercial use.
- No uncontrolled third-party plugin execution.
- No web dashboard before CLI/TUI and gateway foundations are solid.
- No hidden telemetry.
- No secrets in SQLite plaintext except via explicit encrypted credential store.

## User Types

- Solo developer using Singularity as a coding agent.
- Operator using Singularity for recurring automations and research.
- Team using profiles, subagents, and shared skills.
- Builder creating agent products and custom profiles on top of Singularity.
- Non-coding user using skills, messaging apps, and dashboard workflows.

## Core Concepts

### Profile

A profile is an isolated operating identity:

- config
- sessions
- memory
- facts
- skills
- plugins
- gateway bindings
- provider credentials references
- approval policy
- tool policy

### Agent

An agent is an execution role inside a profile:

- system prompt
- model routing policy
- tool permissions
- skill access
- memory scope
- subagent permissions
- scheduler permissions

### Subagent

A subagent is an isolated child execution context:

- own session
- own toolset
- own worktree or sandbox where needed
- bounded task contract
- structured result
- optional reviewer role

### Skill

A skill is procedural memory:

- markdown source of truth
- frontmatter metadata
- trigger conditions
- exact commands or workflows
- linked scripts/templates/references
- version and provenance
- verification steps
- review state

### Fact

A fact is durable declarative memory:

- subject
- predicate
- value
- kind: attribute, decision, open
- confidence
- source session
- source quote
- superseded_by pointer
- created_at / updated_at

### Session

A session is the durable conversation/activity record:

- messages
- parts
- tool calls
- tool results
- approvals
- costs
- model/provider routing
- worktree/sandbox metadata
- platform source
- parent/child lineage

## Surfaces

### CLI/TUI

- Chat session.
- Resume session.
- Search sessions.
- List memory/facts.
- Create/edit skill.
- Load skill.
- Run tool with approval.
- Spawn subagent.
- Run code task in isolated worktree.
- Configure provider/model.
- Configure profile.

### Messaging Gateway

- Telegram adapter.
- Discord adapter.
- Same core session loop as CLI/TUI.
- Approval replies from chat.
- Home channel and topic/thread targeting.
- Platform source tagging in sessions.
- Gateway restart/status commands.

### Web Dashboard

- Session browser.
- Memory/fact editor.
- Skill library.
- Tool-call trace viewer.
- Approval queue.
- Subagent tree.
- Cron/scheduler management.
- Provider/config admin.
- Gateway channel status.

## Required Technical Capabilities

### Provider Neutrality

- Model providers loaded through a provider registry.
- OpenAI-compatible, Anthropic-compatible, local, and custom base URL support.
- Per-agent model routing.
- Fallback provider pool.
- Cost and token accounting.
- No provider-specific logic in agent loop unless hidden behind adapter.

### Memory

- SQLite tables first.
- FTS5 search for sessions and facts.
- Optional embeddings via adapter.
- Fact supersedence chain.
- Source quotes for auditability.
- Global, profile, project, and agent memory scopes.
- Human-editable memory.

### Skills

- Markdown source of truth.
- Global, profile, project, plugin, and package scopes.
- Skill review workflow before auto-created skills become active.
- Skill versioning and provenance.
- Skill usage tracking.
- Skill conflict detection.
- Skill update suggestions when a skill fails or drifts.

### Tools

- Tool registry with metadata.
- Tool risk scoring.
- Approval policy per action/resource.
- External-action classification.
- Shell/path/network safety gates.
- Structured tool-call logs.
- Replay/debug traces.

### Work Isolation

- Code tasks default to git worktree.
- Non-git folders use copy-on-write sandbox or explicit local mode.
- Subagents never share a mutable working directory unless explicitly allowed.
- Every run stores branch, worktree path, base commit, and diff summary.

### Scheduler

- Cron-like jobs.
- One-shot and recurring jobs.
- Delivery targets: CLI local output, Telegram, Discord, dashboard.
- Toolset restrictions per job.
- No recursive job creation from scheduled sessions.

## Acceptance Criteria

CLI/TUI:

- [x] User can install and run `singularity`.
- [x] User can start a chat session.
- [x] User can run a coding task in isolated worktree.
- [x] User can approve/deny shell commands.
- [x] User can save and recall facts.
- [x] User can search prior sessions.
- [x] User can load a skill.
- [x] User can create a reviewed skill from a completed task.
- [x] User can spawn a subagent and see the result.
- [x] User can switch providers/models.
- [x] SQLite DB stores sessions, messages, parts, tool calls, approvals, facts, skills, and costs.
- [x] Tests cover persistence, approvals, skill loading, memory recall, and worktree isolation.

Gateway:

- [x] Telegram message creates/resumes a session.
- [x] Discord message creates/resumes a session.
- [x] Approval prompts can be approved/denied from both apps.
- [x] Platform source and channel/thread IDs are stored.
- [x] Gateway status and restart commands work.
- [x] Gateway sessions share the same memory and skill system.

Dashboard:

- [x] Session search and trace viewer work.
- [x] Memory/fact review works.
- [x] Skill review works.
- [x] Approval queue works.
- [x] Gateway status works.
