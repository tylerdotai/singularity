# singularity-gateway

Telegram and Discord adapters for Singularity messaging gateway.

## Architecture

- Gateway is a transport layer over the same session core (per ARCHITECTURE.md L324-340)
- Must NOT fork a separate agent loop
- Both adapters tag sessions with `source: "telegram"` or `source: "discord"`
- Approval replies mapped via platform-specific UI (inline buttons for Telegram, action rows for Discord)

## Anti-Patterns

- Do NOT add secret handling in plaintext
- Do NOT create a separate agent loop
- Do NOT store session state outside singularity-core session system
