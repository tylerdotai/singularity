// SkillsPanel — Phase 7.2 wired panel.
//
// Read-only view of the skills registered in the active profile's
// `SkillRegistry`. The registry is an in-memory metadata wrapper
// (per `docs/singularity/ARCHITECTURE.md` Phase 3.1); the DB-backed
// layer lands in a later phase. This panel therefore instantiates a
// fresh `SkillRegistry` on mount, calls `list()` (which hides
// `pending` + `denied` by default per `registry.ts` L87-99), and
// surfaces the count + names.
//
// The panel's "empty" state is the realistic current state — the
// registry is empty until the future skill-loader reads skills from
// the profile directory and calls `register()`. We keep the panel
// honest by showing that, rather than fake a populated registry.

import { type Skill, SkillRegistry } from 'singularity-core';
import { For, type JSX, Show } from 'solid-js/dist/solid.js';

export interface SkillsData {
  readonly skills: readonly Skill[];
  readonly totalCount: number;
}

export interface SkillsPanelProps {
  readonly data?: SkillsData;
  readonly error?: string;
}

export async function loadSkills(): Promise<SkillsData> {
  const registry = new SkillRegistry();
  // Default `list()` returns only `active` skills; pass
  // `includeHidden: true` so the count covers every status. The
  // `hiddenCount` surfaces how many `pending` / `denied` skills
  // the registry holds.
  const active = registry.list();
  const all = registry.list({ includeHidden: true });
  return { skills: active, totalCount: all.length };
}

export function SkillsPanel(props: SkillsPanelProps): JSX.Element {
  return (
    <box flexDirection="column" padding={1}>
      <text>
        <strong>Skills</strong>
      </text>
      <text> </text>

      <Show when={props.data === undefined && props.error === undefined}>
        <text>
          <span style={{ fg: '#888888' }}>loading...</span>
        </text>
      </Show>

      <Show when={props.error !== undefined}>
        <text>
          <span style={{ fg: '#cc4444' }}>Error: {props.error}</span>
        </text>
      </Show>

      <Show when={props.data}>
        {(loaded: () => SkillsData) => (
          <>
            <text>
              Active skills: {loaded().skills.length} (total across all
              statuses: {loaded().totalCount})
            </text>
            <text> </text>
            <Show
              when={loaded().skills.length > 0}
              fallback={
                <text>
                  <span style={{ fg: '#888888' }}>
                    No skills registered yet. The Phase 3.x skill-loader will
                    populate the registry from the profile directory.
                  </span>
                </text>
              }
            >
              <For each={loaded().skills}>
                {(skill: Skill) => (
                  <box flexDirection="row">
                    <text>
                      [{skill.scope}] <strong>{skill.name}</strong>{' '}
                      <span style={{ fg: '#888888' }}>v{skill.version}</span> —{' '}
                      {skill.description}
                    </text>
                  </box>
                )}
              </For>
            </Show>
          </>
        )}
      </Show>
    </box>
  );
}
