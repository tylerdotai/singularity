// Plugin registry (Phase 5, in-memory only)
// Manages loaded plugins and invokes hooks

import { PluginError } from './errors.js';
import { unloadPlugin } from './loader.js';
import type { LoadedPlugin } from './schema.js';

/**
 * PluginRegistry manages loaded plugins and their lifecycle hooks.
 * Hook invocations are fire-and-forget (errors logged, not propagated).
 */
export class PluginRegistry {
  private plugins = new Map<string, LoadedPlugin>();

  /**
   * Register a plugin with the registry
   */
  register(plugin: LoadedPlugin): void {
    this.plugins.set(plugin.manifest.name, plugin);
  }

  /**
   * Unregister a plugin by name
   * Returns true if plugin was found and removed
   */
  unregister(name: string): boolean {
    const plugin = this.plugins.get(name);
    if (!plugin) {
      return false;
    }
    unloadPlugin(name);
    this.plugins.delete(name);
    return true;
  }

  /**
   * Get a plugin by name
   */
  get(name: string): LoadedPlugin | undefined {
    return this.plugins.get(name);
  }

  /**
   * List all registered plugins
   */
  list(): LoadedPlugin[] {
    return Array.from(this.plugins.values());
  }

  /**
   * List plugins filtered by scope
   */
  listByScope(scope: string): LoadedPlugin[] {
    return this.list().filter((p) => p.manifest.scope === scope);
  }

  /**
   * Enable a plugin by name
   * Sets status to 'enabled' and calls the onEnable hook
   */
  enable(name: string): void {
    const plugin = this.plugins.get(name);
    if (!plugin) {
      throw new PluginError(`Plugin not found: ${name}`, 'not_loaded', name);
    }

    plugin.status = 'enabled';

    if (plugin.hooks.onEnable) {
      try {
        const result = plugin.hooks.onEnable();
        if (result instanceof Promise) {
          result.catch((err) => {
            console.error(`Plugin ${name} onEnable error:`, err);
          });
        }
      } catch (err) {
        console.error(`Plugin ${name} onEnable error:`, err);
      }
    }
  }

  /**
   * Disable a plugin by name
   * Sets status to 'disabled' and calls the onDisable hook
   */
  disable(name: string): void {
    const plugin = this.plugins.get(name);
    if (!plugin) {
      throw new PluginError(`Plugin not found: ${name}`, 'not_loaded', name);
    }

    plugin.status = 'disabled';

    if (plugin.hooks.onDisable) {
      try {
        const result = plugin.hooks.onDisable();
        if (result instanceof Promise) {
          result.catch((err) => {
            console.error(`Plugin ${name} onDisable error:`, err);
          });
        }
      } catch (err) {
        console.error(`Plugin ${name} onDisable error:`, err);
      }
    }
  }

  /**
   * Invoke beforeTool hook across all enabled plugins
   * Each plugin receives the modified name from the previous plugin (chaining)
   * Last non-undefined result wins
   */
  async invokeBeforeTool(
    name: string,
    input: unknown
  ): Promise<string | undefined> {
    let currentName: string | undefined;

    for (const plugin of this.enabledPlugins()) {
      if (plugin.hooks.beforeTool) {
        try {
          const hookResult = plugin.hooks.beforeTool(
            currentName ?? name,
            input
          );
          const resolved =
            hookResult instanceof Promise ? await hookResult : hookResult;
          if (resolved !== undefined) {
            currentName = resolved;
          }
        } catch (err) {
          console.error(
            `Plugin ${plugin.manifest.name} beforeTool error:`,
            err
          );
        }
      }
    }

    return currentName;
  }

  /**
   * Invoke afterTool hook across all enabled plugins
   * Fire-and-forget, errors are logged
   */
  async invokeAfterTool(
    name: string,
    input: unknown,
    result: unknown
  ): Promise<void> {
    for (const plugin of this.enabledPlugins()) {
      if (plugin.hooks.afterTool) {
        try {
          const hookResult = plugin.hooks.afterTool(name, input, result);
          if (hookResult instanceof Promise) {
            hookResult.catch((err) => {
              console.error(
                `Plugin ${plugin.manifest.name} afterTool error:`,
                err
              );
            });
          }
        } catch (err) {
          console.error(`Plugin ${plugin.manifest.name} afterTool error:`, err);
        }
      }
    }
  }

  /**
   * Invoke onSessionStart hook across all enabled plugins
   */
  async invokeSessionStart(sessionId: string): Promise<void> {
    for (const plugin of this.enabledPlugins()) {
      if (plugin.hooks.onSessionStart) {
        try {
          const hookResult = plugin.hooks.onSessionStart(sessionId);
          if (hookResult instanceof Promise) {
            hookResult.catch((err) => {
              console.error(
                `Plugin ${plugin.manifest.name} onSessionStart error:`,
                err
              );
            });
          }
        } catch (err) {
          console.error(
            `Plugin ${plugin.manifest.name} onSessionStart error:`,
            err
          );
        }
      }
    }
  }

  /**
   * Invoke onSessionEnd hook across all enabled plugins
   */
  async invokeSessionEnd(sessionId: string): Promise<void> {
    for (const plugin of this.enabledPlugins()) {
      if (plugin.hooks.onSessionEnd) {
        try {
          const hookResult = plugin.hooks.onSessionEnd(sessionId);
          if (hookResult instanceof Promise) {
            hookResult.catch((err) => {
              console.error(
                `Plugin ${plugin.manifest.name} onSessionEnd error:`,
                err
              );
            });
          }
        } catch (err) {
          console.error(
            `Plugin ${plugin.manifest.name} onSessionEnd error:`,
            err
          );
        }
      }
    }
  }

  /**
   * Helper to get all enabled plugins
   */
  private enabledPlugins(): LoadedPlugin[] {
    return this.list().filter((p) => p.status === 'enabled');
  }
}
