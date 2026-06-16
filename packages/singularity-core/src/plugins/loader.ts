// Plugin loader (Phase 5, in-memory only)
// Dynamically loads plugin entries from the filesystem

import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PluginError } from './errors.js';
import type { LoadedPlugin, PluginHooks, PluginManifest } from './schema.js';

/**
 * Validate a manifest has all required fields
 */
export function validateManifest(
  manifest: unknown
): manifest is PluginManifest {
  if (typeof manifest !== 'object' || manifest === null) {
    return false;
  }

  const m = manifest as Record<string, unknown>;

  // Required fields
  if (typeof m.name !== 'string' || m.name.length === 0) {
    return false;
  }
  if (typeof m.version !== 'string' || m.version.length === 0) {
    return false;
  }
  if (typeof m.entry !== 'string' || m.entry.length === 0) {
    return false;
  }
  if (typeof m.description !== 'string') {
    return false;
  }

  // Optional fields validation
  if (m.dependencies !== undefined) {
    if (typeof m.dependencies !== 'object' || m.dependencies === null) {
      return false;
    }
  }

  if (m.scope !== undefined) {
    if (
      typeof m.scope !== 'string' ||
      !['user', 'project', 'global'].includes(m.scope)
    ) {
      return false;
    }
  }

  return true;
}

// Track loaded plugins for cleanup
const loadedModules = new Map<string, unknown>();

/**
 * Load a plugin from its manifest and base path
 * Dynamic import of the plugin entry, cast to PluginHooks
 */
export async function loadPluginFromManifest(
  manifest: PluginManifest,
  basePath: string
): Promise<LoadedPlugin> {
  const entryPath = resolve(basePath, manifest.entry);

  // Check if entry file exists
  if (!existsSync(entryPath)) {
    throw new PluginError(
      `Plugin entry not found: ${entryPath}`,
      'entry_not_found',
      manifest.name
    );
  }

  try {
    // Dynamic import of the plugin entry
    const module = await import(entryPath);
    const hooks =
      (module as { default?: PluginHooks }).default ?? (module as PluginHooks);

    // Track the module for potential cleanup
    loadedModules.set(manifest.name, hooks);

    const loadedPlugin: LoadedPlugin = {
      manifest,
      hooks,
      status: 'loaded',
      loadedAt: Date.now(),
    };

    return loadedPlugin;
  } catch (err) {
    throw new PluginError(
      err instanceof Error ? err.message : 'Unknown load error',
      'load_failed',
      manifest.name
    );
  }
}

/**
 * Unload a plugin - clean up plugin resources
 */
export function unloadPlugin(pluginName: string): void {
  loadedModules.delete(pluginName);
}
