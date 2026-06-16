// Telegram and Discord adapters for Singularity messaging gateway

export type {
  CommandContextExt,
  CommandDef,
} from './commands.js';
export {
  buildCommands,
  formatHelp,
  parseCommand,
} from './commands.js';
export {
  buildApprovalActionRow,
  createDiscordAdapter,
  PLATFORM as DiscordPlatform,
} from './discord.js';
export type {
  EngineRunner,
  GatewaySessionBridgeOptions,
  OutgoingMessage,
} from './engine-bridge.js';

export {
  GatewaySessionBridge,
  isSteerCommand,
  textToActivity,
} from './engine-bridge.js';
export type { Platform } from './platform.js';
export { DISCORD_PLATFORM, PLATFORMS, TELEGRAM_PLATFORM } from './platform.js';
export {
  type DraftSkillFromChatOptions,
  type PlatformSkillContext,
  SkillAuthoringService,
} from './skill-authoring.js';
export {
  buildApprovalKeyboard,
  createTelegramAdapter,
  PLATFORM as TelegramPlatform,
  telegramBotCommands,
} from './telegram.js';
