import { useStore, type Tab } from '../store/useStore';
import { useControlStore } from '../store/useControlStore';

const TABS: Tab[] = ['Agents', 'Sessions', 'Projects', 'Usage', 'Config'];

export default function TopNav(): JSX.Element {
  const tab = useStore((s) => s.tab);
  const setTab = useStore((s) => s.setTab);
  const agents = useStore((s) => s.agents);
  const connected = useStore((s) => s.connected);
  const openLaunch = useControlStore((s) => s.openLaunch);
  const openSettings = useControlStore((s) => s.openSettings);

  const busy = agents?.agents.filter((a) => a.status === 'busy').length ?? 0;

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-ink-700/70 bg-ink-900 px-4">
      <div className="flex items-center gap-2 pr-2">
        <div className="grid h-6 w-6 place-items-center rounded-md bg-gradient-to-b from-status-busy to-indigo-500 text-[13px] font-bold text-white shadow-card">
          C
        </div>
        <span className="text-sm font-semibold tracking-tight text-ink-100/90">Cockpit</span>
      </div>

      <nav className="flex items-center gap-1">
        {TABS.map((t) => {
          const active = t === tab;
          const enabled = t === 'Agents';
          return (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={[
                'relative rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors',
                active
                  ? 'bg-ink-750 text-white'
                  : 'text-ink-500 hover:bg-ink-850 hover:text-ink-100/80'
              ].join(' ')}
            >
              {t}
              {!enabled && (
                <span className="ml-1.5 align-middle text-[9px] uppercase tracking-wide text-ink-600">
                  soon
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="ml-auto flex items-center gap-3 text-xs text-ink-500">
        <button
          onClick={openLaunch}
          className="rounded-md bg-accent px-2.5 py-1 text-[12px] font-medium text-white transition-colors hover:bg-accent-soft"
          title="Launch a new agent"
        >
          + Launch
        </button>
        <button
          onClick={openSettings}
          className="grid h-7 w-7 place-items-center rounded-md text-ink-500 transition-colors hover:bg-ink-850 hover:text-ink-100/80"
          title="Notification settings"
        >
          ⚙
        </button>
        <span className="flex items-center gap-1.5">
          <span className={`h-1.5 w-1.5 rounded-full ${busy > 0 ? 'bg-status-busy pulse-dot' : 'bg-ink-600'}`} />
          {busy} running
        </span>
        <span className="flex items-center gap-1.5">
          <span className={`h-1.5 w-1.5 rounded-full ${connected ? 'bg-status-done' : 'bg-status-failed'}`} />
          {connected ? 'engine live' : 'connecting…'}
        </span>
      </div>
    </header>
  );
}
