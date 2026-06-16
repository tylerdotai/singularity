# singularity-dashboard

Dashboard API and Solid.js admin console for Singularity, plus production server.

## Architecture

- Dashboard is an admin/control surface, not a separate product core
- API layer: typed functions over singularity-core data (sessions, facts, skills, approvals, gateway, scheduler)
- UI layer: Solid.js read-only views
- Production server: Bun.serve with WebSocket, JWT auth, rate limiting, AES-256-GCM encryption

## Production Server

The `ProductionServer` class provides:

- `GET /health` — Health check with status and uptime
- `GET /metrics` — Prometheus-compatible metrics
- `POST /api/keys` — Generate API key
- `POST /api/token` — Generate JWT token
- `POST /api/encrypt` — AES-256-GCM encryption
- `POST /api/decrypt` — Decryption
- `WS /api/events` — WebSocket for live updates

## Anti-Patterns

- Do NOT add secret handling in plaintext — use ProductionServer encryption
- Do NOT add data mutation (read-only views only)
- Do NOT modify OpenCode core files
