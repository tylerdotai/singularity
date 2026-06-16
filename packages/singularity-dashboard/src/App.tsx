import { For, Show } from 'solid-js';
import type {
  Approval,
  Fact,
  GatewayChannel,
  SchedulerJob,
  Session,
  Skill,
} from './api.js';

interface AppProps {
  sessions: Session[];
  facts: Fact[];
  skills: Skill[];
  approvals: Approval[];
  gatewayChannels: GatewayChannel[];
  schedulerJobs: SchedulerJob[];
  loading?: boolean;
}

function formatAge(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    const now = Date.now();
    const diff = now - date.getTime();
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

function StatusBadge(props: { status: string }) {
  const colors: Record<string, string> = {
    running: '#25daa5',
    active: '#25daa5',
    completed: '#6b9fff',
    paused: '#f5c518',
    failed: '#ff6b6b',
    denied: '#ff6b6b',
    allowed: '#25daa5',
    pending: '#f5c518',
    enabled: '#25daa5',
    disabled: '#888',
  };
  const color = colors[props.status.toLowerCase()] ?? '#888';
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 8px',
        'border-radius': '12px',
        'font-size': '11px',
        'font-weight': '600',
        'text-transform': 'uppercase',
        'letter-spacing': '0.5px',
        background: `${color}22`,
        color: color,
        border: `1px solid ${color}44`,
      }}
    >
      {props.status}
    </span>
  );
}

function EmptyState(props: { message: string }) {
  return (
    <tr>
      <td
        colspan={100}
        style={{
          'text-align': 'center',
          padding: '32px',
          color: '#666',
          'font-style': 'italic',
        }}
      >
        {props.message}
      </td>
    </tr>
  );
}

function DataTable<T>(props: {
  columns: Array<{ key: keyof T; label: string; render?: (item: T) => any }>;
  data: T[];
  emptyMessage: string;
}) {
  return (
    <table>
      <thead>
        <tr>
          <For each={props.columns}>{(col) => <th>{col.label}</th>}</For>
        </tr>
      </thead>
      <tbody>
        <Show
          when={props.data.length > 0}
          fallback={<EmptyState message={props.emptyMessage} />}
        >
          <For each={props.data}>
            {(item) => (
              <tr>
                <For each={props.columns}>
                  {(col) => (
                    <td>
                      {col.render
                        ? col.render(item)
                        : String(item[col.key] ?? '')}
                    </td>
                  )}
                </For>
              </tr>
            )}
          </For>
        </Show>
      </tbody>
    </table>
  );
}

export function App(props: AppProps) {
  return (
    <div class="singularity-dashboard">
      <style>{`
        .singularity-dashboard {
          font-family: system-ui, -apple-system, sans-serif;
          background: #0a0a0f;
          color: #e0e0e0;
          min-height: 100vh;
          margin: 0;
          padding: 0;
        }
        .singularity-dashboard header {
          background: #12121a;
          border-bottom: 1px solid #2a2a3e;
          padding: 16px 32px;
        }
        .singularity-dashboard header h1 {
          margin: 0;
          font-size: 22px;
          font-weight: 700;
          color: #fff;
          letter-spacing: -0.5px;
        }
        .singularity-dashboard nav {
          display: flex;
          gap: 8px;
          padding: 12px 32px;
          background: #0e0e16;
          border-bottom: 1px solid #1e1e2e;
          overflow-x: auto;
        }
        .singularity-dashboard nav a {
          color: #8888aa;
          text-decoration: none;
          font-size: 13px;
          padding: 6px 14px;
          border-radius: 6px;
          white-space: nowrap;
          transition: color 0.15s, background 0.15s;
        }
        .singularity-dashboard nav a:hover {
          color: #fff;
          background: #2a2a3e;
        }
        .singularity-dashboard main {
          padding: 24px 32px;
          display: flex;
          flex-direction: column;
          gap: 40px;
        }
        .singularity-dashboard section h2 {
          font-size: 16px;
          font-weight: 600;
          color: #fff;
          margin: 0 0 16px 0;
          padding-bottom: 8px;
          border-bottom: 1px solid #2a2a3e;
        }
        .singularity-dashboard table {
          width: 100%;
          border-collapse: collapse;
          font-size: 13px;
        }
        .singularity-dashboard th {
          text-align: left;
          padding: 8px 12px;
          color: #666;
          font-weight: 500;
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          border-bottom: 1px solid #2a2a3e;
        }
        .singularity-dashboard td {
          padding: 10px 12px;
          border-bottom: 1px solid #1a1a24;
          vertical-align: middle;
        }
        .singularity-dashboard tbody tr:hover {
          background: #1a1a28;
        }
        .singularity-dashboard tbody tr:last-child td {
          border-bottom: none;
        }
        .loading-state {
          text-align: center;
          padding: 48px;
          color: #666;
          font-size: 14px;
        }
        .mono {
          font-family: ui-monospace, "Cascadia Code", "Fira Code", monospace;
          font-size: 12px;
          color: #888;
        }
      `}</style>

      <Show when={props.loading}>
        <div class="loading-state">Loading...</div>
      </Show>

      <Show when={!props.loading}>
        <header>
          <h1>Singularity Dashboard</h1>
        </header>

        <nav>
          <a href="#sessions">Sessions</a>
          <a href="#facts">Facts</a>
          <a href="#skills">Skills</a>
          <a href="#approvals">Approvals</a>
          <a href="#gateway">Gateway</a>
          <a href="#scheduler">Scheduler</a>
        </nav>

        <main>
          <section id="sessions">
            <h2>Sessions</h2>
            <DataTable
              data={props.sessions}
              emptyMessage="No sessions yet. Start a conversation with the agent."
              columns={[
                {
                  key: 'id' as keyof Session,
                  label: 'ID',
                  render: (s) => (
                    <span style={{ 'font-family': 'monospace' }}>
                      {s.id.slice(0, 8)}
                    </span>
                  ),
                },
                { key: 'title' as keyof Session, label: 'Title' },
                {
                  key: 'status' as keyof Session,
                  label: 'Status',
                  render: (s) => <StatusBadge status={s.status} />,
                },
                { key: 'source' as keyof Session, label: 'Source' },
                {
                  key: 'startedAt' as keyof Session,
                  label: 'Started',
                  render: (s) => formatAge(s.startedAt),
                },
              ]}
            />
          </section>

          <section id="facts">
            <h2>Facts</h2>
            <DataTable
              data={props.facts}
              emptyMessage="No facts stored. Facts are captured automatically during sessions."
              columns={[
                { key: 'subject' as keyof Fact, label: 'Subject' },
                { key: 'predicate' as keyof Fact, label: 'Predicate' },
                { key: 'value' as keyof Fact, label: 'Value' },
                {
                  key: 'kind' as keyof Fact,
                  label: 'Kind',
                  render: (f) => <StatusBadge status={f.kind} />,
                },
                {
                  key: 'confidence' as keyof Fact,
                  label: 'Confidence',
                  render: (f) => `${Math.round((f.confidence ?? 0) * 100)}%`,
                },
              ]}
            />
          </section>

          <section id="skills">
            <h2>Skills</h2>
            <DataTable
              data={props.skills}
              emptyMessage="No skills registered."
              columns={[
                {
                  key: 'name' as keyof Skill,
                  label: 'Name',
                  render: (s) => (
                    <strong style={{ color: '#fff' }}>{s.name}</strong>
                  ),
                },
                { key: 'description' as keyof Skill, label: 'Description' },
                {
                  key: 'status' as keyof Skill,
                  label: 'Status',
                  render: (s) => <StatusBadge status={s.status} />,
                },
                {
                  key: 'version' as keyof Skill,
                  label: 'Version',
                  render: (s) => (
                    <span style={{ 'font-family': 'monospace' }}>
                      {s.version}
                    </span>
                  ),
                },
              ]}
            />
          </section>

          <section id="approvals">
            <h2>Approvals</h2>
            <DataTable
              data={props.approvals}
              emptyMessage="No approval decisions recorded."
              columns={[
                {
                  key: 'id' as keyof Approval,
                  label: 'ID',
                  render: (a) => (
                    <span style={{ 'font-family': 'monospace' }}>
                      {a.id.slice(0, 8)}
                    </span>
                  ),
                },
                {
                  key: 'action' as keyof Approval,
                  label: 'Action',
                  render: (a) => (
                    <span style={{ 'font-family': 'monospace' }}>
                      {a.action}
                    </span>
                  ),
                },
                {
                  key: 'decision' as keyof Approval,
                  label: 'Decision',
                  render: (a) => <StatusBadge status={a.decision} />,
                },
                { key: 'decidedBy' as keyof Approval, label: 'Decided By' },
                {
                  key: 'decidedAt' as keyof Approval,
                  label: 'At',
                  render: (a) => formatAge(a.decidedAt),
                },
              ]}
            />
          </section>

          <section id="gateway">
            <h2>Gateway Channels</h2>
            <DataTable
              data={props.gatewayChannels}
              emptyMessage="No gateway channels configured."
              columns={[
                {
                  key: 'platform' as keyof GatewayChannel,
                  label: 'Platform',
                  render: (g) => <StatusBadge status={g.platform} />,
                },
                { key: 'name' as keyof GatewayChannel, label: 'Name' },
                {
                  key: 'externalId' as keyof GatewayChannel,
                  label: 'External ID',
                  render: (g) => (
                    <span style={{ 'font-family': 'monospace' }}>
                      {g.externalId}
                    </span>
                  ),
                },
                {
                  key: 'createdAt' as keyof GatewayChannel,
                  label: 'Created',
                  render: (g) => formatAge(g.createdAt),
                },
              ]}
            />
          </section>

          <section id="scheduler">
            <h2>Scheduler Jobs</h2>
            <DataTable
              data={props.schedulerJobs}
              emptyMessage="No scheduler jobs configured."
              columns={[
                { key: 'name' as keyof SchedulerJob, label: 'Name' },
                {
                  key: 'schedule' as keyof SchedulerJob,
                  label: 'Schedule',
                  render: (j) => (
                    <span style={{ 'font-family': 'monospace' }}>
                      {j.schedule}
                    </span>
                  ),
                },
                {
                  key: 'enabled' as keyof SchedulerJob,
                  label: 'Enabled',
                  render: (j) => (
                    <StatusBadge status={j.enabled ? 'enabled' : 'disabled'} />
                  ),
                },
                {
                  key: 'deliveryTarget' as keyof SchedulerJob,
                  label: 'Delivery',
                },
              ]}
            />
          </section>
        </main>
      </Show>
    </div>
  );
}
