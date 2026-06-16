// ChatPanel — Phase 7.2 chat panel.
//
// Read-only message history view with a text input field.
// Message data is loaded from the active session's transcript via
// SessionStore. The input field is wired but does not yet submit
// anywhere (per Phase 7.2 scope: UI only, no interactive REPL).
//
// Data lifecycle:
//   - loadChat() retrieves the most recent active session via
//     ProfileResolver.resolveDefault() + SessionStore.searchDigests.
//   - The session body (markdown transcript) is parsed for chat messages.
//     For Phase 7.2, the panel shows an empty state when no messages
//     are available — real message parsing wires in a future phase.
//   - The panel is a presentational component; it receives data via
//     props and renders the message history + input field.

import { Database } from 'bun:sqlite';
import type { JSX } from '@opentui/solid';
import { ProfileResolver, SessionStore } from 'singularity-core';
import { For, Show } from 'solid-js/dist/solid.js';
import { MIGRATIONS } from '../../../../singularity-core/src/memory/migrations/index.ts';

export interface ChatMessage {
  readonly role: 'user' | 'assistant';
  readonly text: string;
  readonly timestamp: number;
}

export interface ChatData {
  readonly messages: readonly ChatMessage[];
}

export interface ChatPanelProps {
  readonly data?: ChatData;
  readonly error?: string;
}

// Object names produced by memory migrations 001-005. Used by
// `isMemorySchemaPresent` to short-circuit the migration loop on a
// re-run. Copied from MemoryPanel.ts to avoid coupling to its internals.
const POST_MIGRATION_OBJECTS: readonly string[] = [
  'facts',
  'sessions',
  'session_edges',
  'sessions_fts',
  'fact_history',
];

/**
 * Detect whether the memory schema is already in the
 * post-migration state. The check is intentionally based on
 * `sqlite_master` (the source of truth for object existence) rather
 * than the migration barrel version, because the panel does not own
 * the `schema_migrations` table — the production migration runner
 * does, and it does not run on the panel's read path.
 */
function isMemorySchemaPresent(db: Database): boolean {
  const rows = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type IN ('table', 'view') AND name = ?"
    )
    .all(POST_MIGRATION_OBJECTS[0]) as Array<{ name: string }>;
  const present = new Set<string>(rows.map((r) => r.name));
  for (let i = 1; i < POST_MIGRATION_OBJECTS.length; i++) {
    const more = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type IN ('table', 'view') AND name = ?"
      )
      .all(POST_MIGRATION_OBJECTS[i]) as Array<{ name: string }>;
    for (const row of more) present.add(row.name);
  }
  return POST_MIGRATION_OBJECTS.every((name) => present.has(name));
}

/**
 * Load chat messages from the most recent active session.
 * Returns an empty array when no session or transcript is available.
 * Real message parsing (extracting user/assistant turns from markdown
 * body) is wired in a future phase; Phase 7.2 returns an empty list.
 */
export async function loadChat(): Promise<ChatData> {
  const resolver = new ProfileResolver();
  const resolved = await resolver.resolveDefault();
  const db = new Database(resolved.stateDbPath);
  try {
    if (!isMemorySchemaPresent(db)) {
      for (const migration of MIGRATIONS) {
        db.exec(migration.sql);
      }
    }
    const sessionStore = new SessionStore(db);
    // Get the most recent active or closed session
    const sessions = sessionStore.searchDigests({ limit: 1 });
    if (sessions.length === 0) {
      return { messages: [] };
    }
    const session = sessions[0];
    // For Phase 7.2, messages are not yet extracted from the body.
    // Return an empty list; real parsing lands in a future phase.
    void session;
    return { messages: [] };
  } finally {
    db.close();
  }
}

function formatTimestamp(ts: number): string {
  const date = new Date(ts);
  return date.toISOString().replace('T', ' ').slice(0, 19);
}

function roleLabel(role: 'user' | 'assistant'): string {
  return role === 'user' ? 'you' : 'assistant';
}

function roleColor(role: 'user' | 'assistant'): string {
  return role === 'user' ? '#4ade80' : '#60a5fa';
}

export function ChatPanel(props: ChatPanelProps): JSX.Element {
  return (
    <box flexDirection="column" padding={1}>
      {/* Header */}
      <text>
        <strong>Chat</strong>
      </text>
      <text> </text>

      {/* Loading state */}
      <Show when={props.data === undefined && props.error === undefined}>
        <text>
          <span style={{ fg: '#888888' }}>loading messages...</span>
        </text>
      </Show>

      {/* Error state */}
      <Show when={props.error !== undefined}>
        <text>
          <span style={{ fg: '#cc4444' }}>Error: {props.error}</span>
        </text>
      </Show>

      {/* Message history */}
      <Show when={props.data}>
        {(loaded: () => ChatData) => (
          <Show
            when={loaded().messages.length > 0}
            fallback={
              <text>
                <span style={{ fg: '#888888' }}>
                  No messages yet. Start a conversation to see messages here.
                </span>
              </text>
            }
          >
            <box flexDirection="column" flexGrow={1}>
              <For each={loaded().messages}>
                {(msg: ChatMessage) => (
                  <box flexDirection="row" marginBottom={1}>
                    <text>
                      <span style={{ fg: roleColor(msg.role) }}>
                        [{roleLabel(msg.role)}]
                      </span>
                      <span style={{ fg: '#888888' }}>
                        {' '}
                        {formatTimestamp(msg.timestamp)}
                      </span>
                    </text>
                    <text> </text>
                    <text>{msg.text}</text>
                  </box>
                )}
              </For>
            </box>
          </Show>
        )}
      </Show>

      {/* Input area — Phase 7.2: static prompt, input wired in future phase */}
      <box flexDirection="row" marginTop={1} alignItems="center">
        <text>
          <span style={{ fg: '#4ade80' }}>{'> '}</span>
          <span style={{ fg: '#888888' }}>Type a message...</span>
        </text>
      </box>
    </box>
  );
}
