# singularity-cli

Phase 20 CLI entrypoint package. Provides the `singularity` binary with command surfaces:

- `singularity` — root help/status
- `singularity chat <msg>` — chat with agent
- `singularity subagent <goal>` — spawn subagent task
- `singularity server [port]` — start production server (default: 18678)
- `singularity loops run <goal>` — run closed-loop evaluator
- `singularity gateway start` — launch Telegram/Discord gateway
- `singularity memory facts` — memory facts status
- `singularity skills list` — skills listing
- `singularity profile list` — profile list
- `singularity doctor install` — installation diagnostics
- `singularity doctor memory` — memory audit
- `singularity setup` — interactive onboarding

## Production server

The `server` command starts `ProductionServer` with:
- JWT authentication
- Rate limiting (100 req/min per user)
- AES-256-GCM encryption
- Prometheus metrics at `/metrics`
- Health check at `/health`
- WebSocket at `/api/events`

## Phase 20 scope

Production-ready CLI with subagent spawning, production server, gateway adapters wired, and Codex/OpenCode agent dispatch integration.
