// Shared platform type and adapter interface for the gateway.
export const PLATFORMS = ['telegram', 'discord'] as const;
export type Platform = (typeof PLATFORMS)[number];

export const TELEGRAM_PLATFORM: Platform = 'telegram';
export const DISCORD_PLATFORM: Platform = 'discord';

// ---------------------------------------------------------------------------
// PlatformAdapter interface
// ---------------------------------------------------------------------------

/**
 * Common contract implemented by both Telegram and Discord adapters.
 * Unifies session management, messaging, and approval workflows.
 */
export interface PlatformAdapter {
  readonly platform: Platform;
  readonly platformDisplayName: string;

  // Session management
  startSession(chatId: string, source: Platform): string;
  endSession(sessionId: string): void;

  // Messaging
  sendMessage(sessionId: string, text: string): Promise<void>;
  sendTypingIndicator(sessionId: string): Promise<void>;

  // Approval responses
  sendApprovalRequest(
    sessionId: string,
    tool: string,
    args: unknown
  ): Promise<string>;
  approve(approvalId: string): Promise<void>;
  deny(approvalId: string): Promise<void>;

  // Lifecycle
  start(): Promise<void>;
  stop(): Promise<void>;
}
