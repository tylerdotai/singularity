// App — TUI shell for `singularity tui`.
//
// Renders a header, a TabSelect with six tabs (Approvals, Subagents, Skills,
// Memory, Worktree, Chat), and an active-panel area. Tab switching is driven
// by the TabSelect's `onChange` callback. Keyboard shortcuts (q / ctrl+c) are
// handled via `useKeyboard` to call `renderer.destroy()` for a clean exit.
//
// Phase 7.2 scope: tab navigation + placeholder panel content only. No data
// fetching, no approval flow, no subagent spawning. See
// docs/IMPLEMENTATION_PLAN.md Phase 7.2 for what is and is not in scope.

import { type JSX, useKeyboard, useRenderer } from '@opentui/solid';
import {
  createContext,
  createSignal,
  onCleanup,
  onMount,
  useContext,
} from 'solid-js/dist/solid.js';

import { LOGO_ART, WORDMARK } from './banner.js';
import {
  type ApprovalData,
  ApprovalsPanel,
  loadApprovals,
} from './panels/ApprovalsPanel.js';
import { type ChatData, ChatPanel, loadChat } from './panels/ChatPanel.js';
import {
  loadMemory,
  type MemoryData,
  MemoryPanel,
} from './panels/MemoryPanel.js';
import {
  loadSkills,
  type SkillsData,
  SkillsPanel,
} from './panels/SkillsPanel.js';
import {
  loadSubagents,
  type SubagentData,
  SubagentsPanel,
} from './panels/SubagentsPanel.js';
import {
  loadWorktrees,
  type WorktreeData,
  WorktreePanel,
} from './panels/WorktreePanel.js';
import { loadSkinFromConfig, type Skin, type ThemeColors } from './theme.js';

export interface PanelSnapshot<T> {
  readonly data?: T;
  readonly error?: string;
}

export interface TuiSnapshot {
  readonly approvals: PanelSnapshot<ApprovalData>;
  readonly subagents: PanelSnapshot<SubagentData>;
  readonly skills: PanelSnapshot<SkillsData>;
  readonly memory: PanelSnapshot<MemoryData>;
  readonly worktree: PanelSnapshot<WorktreeData>;
  readonly chat: PanelSnapshot<ChatData>;
}

async function capture<T>(loader: () => Promise<T>): Promise<PanelSnapshot<T>> {
  try {
    return { data: await loader() };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

export async function loadTuiSnapshot(): Promise<TuiSnapshot> {
  const [approvals, subagents, skills, memory, worktree, chat] =
    await Promise.all([
      capture(loadApprovals),
      capture(loadSubagents),
      capture(loadSkills),
      capture(loadMemory),
      capture(loadWorktrees),
      capture(loadChat),
    ]);
  return { approvals, subagents, skills, memory, worktree, chat };
}

export interface TabDef {
  name: string;
  description: string;
  label: string;
  panel: (snapshot: TuiSnapshot) => JSX.Element;
}

export const TABS: readonly TabDef[] = [
  {
    name: 'approvals',
    description: 'Pending approval requests',
    label: 'Approvals',
    panel: (snapshot) => <ApprovalsPanel {...snapshot.approvals} />,
  },
  {
    name: 'subagents',
    description: 'Active and recent subagent tasks',
    label: 'Subagents',
    panel: (snapshot) => <SubagentsPanel {...snapshot.subagents} />,
  },
  {
    name: 'skills',
    description: 'Available skills',
    label: 'Skills',
    panel: (snapshot) => <SkillsPanel {...snapshot.skills} />,
  },
  {
    name: 'memory',
    description: 'Memory facts for the active profile',
    label: 'Memory',
    panel: (snapshot) => <MemoryPanel {...snapshot.memory} />,
  },
  {
    name: 'worktree',
    description: 'Active worktree run state',
    label: 'Worktree',
    panel: (snapshot) => <WorktreePanel {...snapshot.worktree} />,
  },
  {
    name: 'chat',
    description: 'Chat with the agent',
    label: 'Chat',
    panel: (snapshot) => <ChatPanel {...snapshot.chat} />,
  },
] as const;

function findTabIndexByName(name: string): number {
  const idx = TABS.findIndex((t) => t.name === name);
  return idx === -1 ? 0 : idx;
}

// ── Theme context ─────────────────────────────────────────────────────────────

interface ThemeContextValue {
  readonly skin: Skin;
  readonly colors: ThemeColors;
  /** Detected terminal width in columns. Falls back to 80 when undetectable. */
  readonly terminalWidth: () => number;
}

const ThemeContext = createContext<ThemeContextValue>();

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme() must be used inside <ThemeContext.Provider>');
  }
  return ctx;
}

// ── App ───────────────────────────────────────────────────────────────────────

export interface AppProps {
  readonly snapshot: TuiSnapshot;
}

export function App(props: AppProps): JSX.Element {
  const [activeIndex, setActiveIndex] = createSignal(0);
  const [skin, setSkin] = createSignal<Skin>(loadSkinFromConfig());
  // TODO: wire process.stdout.on("resize") once @opentui/solid exposes it
  const [terminalWidth, setTerminalWidth] = createSignal<number>(
    typeof process !== 'undefined' && process.stdout?.columns
      ? process.stdout.columns
      : 80
  );

  if (typeof process !== 'undefined' && process.stdout) {
    process.stdout.on('resize', () => {
      setTerminalWidth(process.stdout.columns ?? 80);
    });
  }

  const renderer = useRenderer();
  const stdin = renderer.stdin as unknown as {
    on(event: 'data', callback: (chunk: unknown) => void): void;
    off(event: 'data', callback: (chunk: unknown) => void): void;
  };

  const handleRawInput = (chunk: unknown) => {
    const sequence =
      typeof chunk === 'string'
        ? chunk
        : chunk !== null &&
            typeof (chunk as { toString?: unknown }).toString === 'function'
          ? (chunk as { toString(): string }).toString()
          : '';
    if (sequence === 'q') {
      renderer.destroy();
    }
  };

  onMount(() => {
    // Re-load skin now that we are in the async event loop (home dir resolved).
    setSkin(loadSkinFromConfig());
  });

  useKeyboard((event) => {
    if (event.name === 'q' || (event.ctrl && event.name === 'c')) {
      renderer.destroy();
      return;
    }
    if (event.name === 'left') {
      setActiveIndex((i) => (i - 1 + TABS.length) % TABS.length);
    } else if (event.name === 'right') {
      setActiveIndex((i) => (i + 1) % TABS.length);
    } else if (event.name === '1') {
      setActiveIndex(0);
    } else if (event.name === '2') {
      setActiveIndex(1);
    } else if (event.name === '3') {
      setActiveIndex(2);
    } else if (event.name === '4') {
      setActiveIndex(3);
    } else if (event.name === '5') {
      setActiveIndex(4);
    } else if (event.name === '6') {
      setActiveIndex(5);
    }
  });

  onMount(() => stdin.on('data', handleRawInput));
  onCleanup(() => stdin.off('data', handleRawInput));

  const themeCtx: ThemeContextValue = {
    get skin() {
      return skin();
    },
    get colors() {
      return skin().colors;
    },
    terminalWidth,
  };

  const showFullBanner = () => !skin().compact && terminalWidth() >= 60;

  const tabOptions = () =>
    TABS.map((t) => ({ name: t.name, description: t.description }));

  const onTabChange = (index: number) => {
    if (index >= 0 && index < TABS.length) {
      setActiveIndex(index);
    }
  };

  return (
    <ThemeContext.Provider value={themeCtx}>
      <box flexDirection="column" width="100%" height="100%">
        {/* ── Banner ── */}
        <box
          flexDirection="column"
          border={true}
          borderStyle="single"
          borderColor={skin().colors.border}
        >
          {showFullBanner() ? (
            <LogoBanner colors={skin().colors} />
          ) : (
            <WordmarkBanner colors={skin().colors} />
          )}
        </box>

        {/* ── Tab bar ── */}
        <tab_select
          options={tabOptions()}
          focused={true}
          onChange={onTabChange}
          tabWidth={20}
          showDescription={true}
          showUnderline={true}
        />

        {/* ── Active panel ── */}
        <box
          flexDirection="column"
          flexGrow={1}
          border={true}
          borderStyle="single"
          title={` ${TABS[activeIndex()].label} `}
        >
          {TABS[activeIndex()].panel(props.snapshot)}
        </box>

        {/* ── Footer ── */}
        <box flexDirection="row" paddingLeft={1} paddingRight={1}>
          <text>
            <span style={{ fg: '#888888' }}>
              Tab: {TABS[activeIndex()].label} (use ←/→ to switch, 1-6 to jump)
            </span>
          </text>
        </box>
      </box>
    </ThemeContext.Provider>
  );
}

// ── LogoBanner ───────────────────────────────────────────────────────────────

interface LogoBannerProps {
  readonly colors: ThemeColors;
}

function LogoBanner(props: LogoBannerProps): JSX.Element {
  return (
    <box flexDirection="column" paddingLeft={1} paddingRight={1}>
      {LOGO_ART.map((line) => (
        // biome-ignore lint: Ink span does not support key prop
        <span style={{ fg: props.colors.primary }}>{line}</span>
      ))}
    </box>
  );
}

// ── WordmarkBanner ───────────────────────────────────────────────────────────

interface WordmarkBannerProps {
  readonly colors: ThemeColors;
}

function WordmarkBanner(props: WordmarkBannerProps): JSX.Element {
  return (
    <text>
      <strong>
        <span style={{ fg: props.colors.primary }}>{WORDMARK}</span>
      </strong>
      <span style={{ fg: props.colors.muted }}>tui — phase 7.2</span>
    </text>
  );
}

export { findTabIndexByName };
