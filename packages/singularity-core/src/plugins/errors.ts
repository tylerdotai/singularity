// Plugin error types (Phase 5, in-memory only)

export type PluginErrorKind =
  | 'manifest_invalid'
  | 'entry_not_found'
  | 'load_failed'
  | 'hook_error'
  | 'not_loaded'
  | 'already_loaded';

export class PluginError extends Error {
  constructor(
    public message: string,
    public kind: PluginErrorKind,
    public pluginName?: string
  ) {
    super(message);
    this.name = 'PluginError';
  }
}
