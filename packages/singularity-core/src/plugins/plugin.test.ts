import { beforeEach, describe, expect, it } from 'bun:test';
import { validateManifest } from './loader.js';
import { PluginRegistry } from './registry.js';
import type { LoadedPlugin, PluginHooks, PluginManifest } from './schema.js';

describe('PluginRegistry', () => {
  let registry: PluginRegistry;

  const createMockPlugin = (
    name: string,
    hooks: PluginHooks = {}
  ): LoadedPlugin => ({
    manifest: {
      name,
      version: '1.0.0',
      description: `Test plugin ${name}`,
      entry: `./${name}.js`,
    },
    hooks,
    status: 'loaded',
    loadedAt: Date.now(),
  });

  beforeEach(() => {
    registry = new PluginRegistry();
  });

  it('register + get returns the plugin', () => {
    const plugin = createMockPlugin('test-plugin');
    registry.register(plugin);

    const retrieved = registry.get('test-plugin');
    expect(retrieved).toBe(plugin);
  });

  it('list returns all registered', () => {
    const plugin1 = createMockPlugin('plugin-1');
    const plugin2 = createMockPlugin('plugin-2');
    registry.register(plugin1);
    registry.register(plugin2);

    const all = registry.list();
    expect(all).toHaveLength(2);
    expect(all).toContain(plugin1);
    expect(all).toContain(plugin2);
  });

  it('enable changes status and calls onEnable hook', async () => {
    let enableCalled = false;
    let disableCalled = false;

    const plugin = createMockPlugin('test-plugin', {
      onEnable: () => {
        enableCalled = true;
      },
      onDisable: () => {
        disableCalled = true;
      },
    });

    registry.register(plugin);
    registry.enable('test-plugin');

    expect(plugin.status).toBe('enabled');
    expect(enableCalled).toBe(true);
  });

  it('disable changes status and calls onDisable hook', async () => {
    let disableCalled = false;

    const plugin = createMockPlugin('test-plugin', {
      onDisable: () => {
        disableCalled = true;
      },
    });

    registry.register(plugin);
    registry.enable('test-plugin');
    registry.disable('test-plugin');

    expect(plugin.status).toBe('disabled');
    expect(disableCalled).toBe(true);
  });

  it('invokeBeforeTool chains through all enabled plugins (last non-undefined wins)', async () => {
    const plugin1 = createMockPlugin('plugin-1', {
      beforeTool: (name) => `${name}-p1`,
    });
    const plugin2 = createMockPlugin('plugin-2', {
      beforeTool: (name) => `${name}-p2`,
    });
    const plugin3 = createMockPlugin('plugin-3', {
      beforeTool: (name) => `${name}-p3`,
    });

    registry.register(plugin1);
    registry.register(plugin2);
    registry.register(plugin3);

    registry.enable('plugin-1');
    registry.enable('plugin-2');
    registry.enable('plugin-3');

    const result = await registry.invokeBeforeTool('tool', {});
    expect(result).toBe('tool-p1-p2-p3');
  });

  it('invokeBeforeTool returns undefined when no plugins return a value', async () => {
    const plugin = createMockPlugin('test-plugin', {
      beforeTool: () => undefined,
    });

    registry.register(plugin);
    registry.enable('test-plugin');

    const result = await registry.invokeBeforeTool('tool', {});
    expect(result).toBeUndefined();
  });

  it('invokeAfterTool calls all enabled plugins', async () => {
    const calls: string[] = [];

    const plugin1 = createMockPlugin('plugin-1', {
      afterTool: (_n, _i, _r) => {
        calls.push('p1');
      },
    });
    const plugin2 = createMockPlugin('plugin-2', {
      afterTool: (_n, _i, _r) => {
        calls.push('p2');
      },
    });

    registry.register(plugin1);
    registry.register(plugin2);
    registry.enable('plugin-1');
    registry.enable('plugin-2');

    await registry.invokeAfterTool('tool', {}, 'result');

    expect(calls).toEqual(['p1', 'p2']);
  });

  it('get for unknown plugin returns undefined', () => {
    const result = registry.get('nonexistent');
    expect(result).toBeUndefined();
  });

  it('unregister removes plugin', () => {
    const plugin = createMockPlugin('test-plugin');
    registry.register(plugin);

    const removed = registry.unregister('test-plugin');
    expect(removed).toBe(true);
    expect(registry.get('test-plugin')).toBeUndefined();
  });

  it('unregister returns false for unknown plugin', () => {
    const removed = registry.unregister('nonexistent');
    expect(removed).toBe(false);
  });

  it('register with duplicate name overwrites', () => {
    const plugin1 = createMockPlugin('test-plugin', { onEnable: () => {} });
    const plugin2 = createMockPlugin('test-plugin', { onEnable: () => {} });

    registry.register(plugin1);
    registry.register(plugin2);

    const all = registry.list();
    expect(all).toHaveLength(1);
    expect(registry.get('test-plugin')).toBe(plugin2);
  });

  it('listByScope filters plugins by scope', () => {
    const userPlugin = createMockPlugin('user-plugin');
    userPlugin.manifest.scope = 'user';
    const projectPlugin = createMockPlugin('project-plugin');
    projectPlugin.manifest.scope = 'project';

    registry.register(userPlugin);
    registry.register(projectPlugin);

    const userPlugins = registry.listByScope('user');
    expect(userPlugins).toHaveLength(1);
    expect(userPlugins[0].manifest.name).toBe('user-plugin');
  });

  it('enable only affects enabled plugins in hook chains', async () => {
    const beforeCalls: string[] = [];

    const plugin1 = createMockPlugin('plugin-1', {
      beforeTool: (_n, _i) => {
        beforeCalls.push('p1');
        return undefined;
      },
    });
    const plugin2 = createMockPlugin('plugin-2', {
      beforeTool: (_n, _i) => {
        beforeCalls.push('p2');
        return undefined;
      },
    });

    registry.register(plugin1);
    registry.register(plugin2);
    registry.enable('plugin-1');
    // plugin2 not enabled

    await registry.invokeBeforeTool('tool', {});

    expect(beforeCalls).toEqual(['p1']);
  });
});

describe('validateManifest', () => {
  it('valid manifest passes validation', () => {
    const manifest = {
      name: 'test-plugin',
      version: '1.0.0',
      description: 'A test plugin',
      entry: './index.js',
    };

    expect(validateManifest(manifest)).toBe(true);
  });

  it('valid manifest with optional fields passes validation', () => {
    const manifest = {
      name: 'test-plugin',
      version: '1.0.0',
      description: 'A test plugin',
      entry: './index.js',
      dependencies: { 'some-dep': '^1.0.0' },
      scope: 'user' as const,
    };

    expect(validateManifest(manifest)).toBe(true);
  });

  it('missing name fails validation', () => {
    const manifest = {
      version: '1.0.0',
      description: 'A test plugin',
      entry: './index.js',
    };

    expect(validateManifest(manifest)).toBe(false);
  });

  it('empty name fails validation', () => {
    const manifest = {
      name: '',
      version: '1.0.0',
      description: 'A test plugin',
      entry: './index.js',
    };

    expect(validateManifest(manifest)).toBe(false);
  });

  it('missing version fails validation', () => {
    const manifest = {
      name: 'test-plugin',
      description: 'A test plugin',
      entry: './index.js',
    };

    expect(validateManifest(manifest)).toBe(false);
  });

  it('missing entry fails validation', () => {
    const manifest = {
      name: 'test-plugin',
      version: '1.0.0',
      description: 'A test plugin',
    };

    expect(validateManifest(manifest)).toBe(false);
  });

  it('null manifest fails validation', () => {
    expect(validateManifest(null)).toBe(false);
  });

  it('string manifest fails validation', () => {
    expect(validateManifest('not an object')).toBe(false);
  });

  it('invalid scope fails validation', () => {
    const manifest = {
      name: 'test-plugin',
      version: '1.0.0',
      description: 'A test plugin',
      entry: './index.js',
      scope: 'invalid-scope',
    };

    expect(validateManifest(manifest)).toBe(false);
  });

  it('invalid dependencies type fails validation', () => {
    const manifest = {
      name: 'test-plugin',
      version: '1.0.0',
      description: 'A test plugin',
      entry: './index.js',
      dependencies: 'not an object',
    };

    expect(validateManifest(manifest)).toBe(false);
  });
});
