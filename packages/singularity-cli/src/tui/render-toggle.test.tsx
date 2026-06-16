import { expect, test } from 'bun:test';
import { testRender } from '@opentui/solid';

await import('@opentui/solid/preload');

const { ApprovalsPanel } = await import('./panels/ApprovalsPanel.js');
const { SubagentsPanel } = await import('./panels/SubagentsPanel.js');
const { SkillsPanel } = await import('./panels/SkillsPanel.js');
const { MemoryPanel } = await import('./panels/MemoryPanel.js');
const { WorktreePanel } = await import('./panels/WorktreePanel.js');

const PANELS = [
  ['Approvals', ApprovalsPanel],
  ['Subagents', SubagentsPanel],
  ['Skills', SkillsPanel],
  ['Memory', MemoryPanel],
  ['Worktree', WorktreePanel],
] as const;

for (const [name, Comp] of PANELS) {
  test(`${name}Panel renders under testRender without throwing`, async () => {
    const setup = await testRender(() => Comp({}), {
      width: 120,
      height: 40,
    });
    await setup.flush();
    const frame = await setup.waitForFrame((f: string) => f.includes(name));
    expect(frame).toContain(name);
    setup.renderer.destroy();
  });
}
