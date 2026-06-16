import { Glob } from 'bun';
import type { ToolInstance } from '../registry.js';
import type { SubsystemMetadata } from '../types.js';

export class ToolLoader {
  private tools: ToolInstance[] = [];

  async loadFromDirectory(dir: string): Promise<ToolInstance[]> {
    const glob = new Glob('*.ts');
    const toolFiles = glob.scanSync({ cwd: dir, onlyFiles: true });
    const loaded: ToolInstance[] = [];

    for (const file of toolFiles) {
      if (file === 'index.ts' || file === 'loader.ts') continue;
      const modulePath = `${dir}/${file}`;
      const mod = await import(modulePath);
      const tool = mod.TOOL ?? mod.default;
      if (tool && typeof tool.name === 'string') {
        loaded.push(tool);
      }
    }

    this.tools = loaded;
    return loaded;
  }

  discoverSubsystems(): SubsystemMetadata[] {
    const subsystemMap = new Map<string, Set<string>>();
    for (const tool of this.tools) {
      for (const sub of tool.subsystem ?? []) {
        if (!subsystemMap.has(sub)) {
          subsystemMap.set(sub, new Set());
        }
        subsystemMap.get(sub)?.add(tool.name);
      }
    }
    return [...subsystemMap.entries()].map(([name, tools]) => ({
      name,
      tools: [...tools],
    }));
  }

  getTools(): ToolInstance[] {
    return this.tools;
  }
}
