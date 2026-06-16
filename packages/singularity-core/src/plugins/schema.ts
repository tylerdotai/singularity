// Plugin subsystem types (Phase 5, in-memory only)

export type PluginStatus = 'loaded' | 'enabled' | 'disabled' | 'error';

export interface PluginManifest {
  name: string; // e.g. "github-integration"
  version: string; // semver
  description: string;
  entry: string; // relative path to the plugin entry file
  dependencies?: Record<string, string>; // peer dep constraints
  scope?: 'user' | 'project' | 'global';
}

export interface Plugin {
  manifest: PluginManifest;
  status: PluginStatus;
  loadedAt: number | null; // timestamp when loaded
  error?: string; // last error message if status === 'error'
}

// Plugin API surface that plugins can expose
export interface PluginHooks {
  // Called when plugin is enabled
  onEnable?(): Promise<void> | void;
  // Called when plugin is disabled
  onDisable?(): Promise<void> | void;
  // Called on every tool execution (return modified tool name to intercept, or undefined to passthrough)
  beforeTool?(
    name: string,
    input: unknown
  ): Promise<string | undefined> | string | undefined;
  // Called after tool execution
  afterTool?(
    name: string,
    input: unknown,
    result: unknown
  ): Promise<void> | void;
  // Called on session start
  onSessionStart?(sessionId: string): Promise<void> | void;
  // Called on session end
  onSessionEnd?(sessionId: string): Promise<void> | void;
}

export interface LoadedPlugin {
  manifest: PluginManifest;
  hooks: PluginHooks;
  status: PluginStatus;
  loadedAt: number | null;
  error?: string;
}
