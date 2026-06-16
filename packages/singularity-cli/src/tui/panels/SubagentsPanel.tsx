// SubagentsPanel — Phase 7.2 wired panel.
//
// Read-only view of the active subagent task state. The Phase 6.2
// subagent contract subsystem is a *contract* layer only — there is
// no `subagents` table, no in-memory task list, and no runner that
// would hold "active" tasks. Per
// `docs/IMPLEMENTATION_PLAN.md` Phase 6.2 limitations, persistence
// and a CLI surface land in later phases.
//
// The panel therefore shows:
//   1. A short status line that the runtime is not yet wired (the
//      empty / not-yet-implemented state) — important so the user
//      does not mistake the panel for a working surface.
//   2. The canonical contract field set (the seven Phase 6.2
//      required fields plus the optional profile / session / agent
//      identifiers), rendered from a `normalizeSubagentTaskContract`
//      example. The example is built from the validator's own
//      defaults so the panel doubles as a live check that the
//      validator surface imports cleanly.
//
// The contract demo is built once at module load (no DB, no IO); the

import {
  normalizeSubagentTaskContract,
  type SubagentTaskContract,
} from 'singularity-core';
import { For, type JSX, Show } from 'solid-js/dist/solid.js';

export interface SubagentData {
  readonly contract: SubagentTaskContract;
  readonly taskCount: number;
  readonly tasks?: ReadonlyArray<{
    id: string;
    status: string;
    goal: string;
  }>;
}

export interface SubagentsPanelProps {
  readonly data?: SubagentData;
  readonly error?: string;
  readonly orchestrator?: {
    getAllTasks(): Array<{
      id: string;
      status: string;
      contract: { goal: string };
    }>;
  };
}

export async function loadSubagents(
  orchestrator?: SubagentsPanelProps['orchestrator']
): Promise<SubagentData> {
  const tasks = orchestrator?.getAllTasks() ?? [];
  const contract = normalizeSubagentTaskContract({
    goal: 'Demonstrate the Phase 6.2 contract shape from the TUI.',
    context: {
      summary:
        'Read-only demo of the seven required fields and the optional profile/agent ids.',
      references: [{ kind: 'session', value: 'sess_demo' }],
    },
    allowedTools: ['read:file'],
    modelPolicy: { provider: 'noop', model: 'noop-1' },
    resultSchema: { kind: 'text' },
    maxTurns: 5,
    profileId: 'prof_default',
    agentId: 'agent_demo',
  });
  return {
    contract,
    taskCount: tasks.length,
    tasks: tasks.map((t) => ({
      id: t.id,
      status: t.status,
      goal: t.contract.goal,
    })),
  };
}

function contractFieldLines(contract: SubagentTaskContract): readonly string[] {
  return [
    `id:              ${contract.id}`,
    `goal:            ${contract.goal}`,
    `allowedTools:    [${contract.allowedTools.join(', ')}]`,
    `workIsolation:   ${contract.workIsolation.kind}`,
    `resultSchema:    ${contract.resultSchema.kind}`,
    `maxTurns:        ${contract.maxTurns}`,
    `profileId:       ${contract.profileId ?? '<none>'}`,
    `agentId:         ${contract.agentId ?? '<none>'}`,
    `parentSessionId: ${contract.parentSessionId ?? '<none>'}`,
  ];
}

export function SubagentsPanel(props: SubagentsPanelProps): JSX.Element {
  return (
    <box flexDirection="column" padding={1}>
      <text>
        <strong>Subagents</strong>
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
        {(loaded: () => SubagentData) => {
          const tasks = loaded().tasks ?? [];
          return (
            <>
              <Show
                when={tasks.length > 0}
                fallback={
                  <text>
                    <span style={{ fg: '#888888' }}>
                      No active subagent tasks.
                    </span>
                  </text>
                }
              >
                <For each={tasks}>
                  {(task) => (
                    <text>
                      [{task.status}] {task.goal.slice(0, 50)}
                    </text>
                  )}
                </For>
              </Show>
              <text>Active tasks: {loaded().taskCount}</text>
              <text> </text>
              <Show when={loaded().taskCount === 0}>
                <text>
                  <span style={{ fg: '#888888' }}>
                    Example normalized contract (read-only):
                  </span>
                </text>
                <Show
                  when={contractFieldLines(loaded().contract).length > 0}
                  fallback={null}
                >
                  <For each={contractFieldLines(loaded().contract)}>
                    {(line) => <text>{line}</text>}
                  </For>
                </Show>
              </Show>
            </>
          );
        }}
      </Show>
    </box>
  );
}
