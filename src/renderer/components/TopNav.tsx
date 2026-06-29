import { Plus, Settings, SquareTerminal } from 'lucide-react';
import { useStore, type Tab } from '../store/useStore';
import { useControlStore } from '../store/useControlStore';

const TABS: Tab[] = ['Session', 'Agents', 'Usage', 'Projects', 'Config'];

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
        <div className="grid h-6 w-6 place-items-center rounded-md bg-accent text-ink-50">
          <SquareTerminal size={15} strokeWidth={2} />
        </div>
        <span className="text-sm font-semibold tracking-tight text-ink-100">Cockpit</span>
      </div>

      <nav className="flex items-center gap-1">
        {TABS.map((t) => {
          const active = t === tab;
          const enabled = t === 'Session' || t === 'Agents' || t === 'Usage';
          return (
            <button
              key={t}
              disabled={!enabled}
              onClick={() => {
                if (enabled) setTab(t);
              }}
              className={[
                'relative cursor-pointer rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors duration-150',
                active ? 'text-ink-50' : 'text-ink-400 hover:text-ink-100',
                'disabled:cursor-not-allowed disabled:opacity-60'
              ].join(' ')}
            >
              {t}
              {!enabled && (
                <span className="ml-1.5 align-middle text-[9px] uppercase tracking-wide text-ink-600">
                  soon
                </span>
              )}
              {active && (
                <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-accent" />
              )}
            </button>
          );
        })}
      </nav>

      <div className="ml-auto flex items-center gap-3 text-xs text-ink-500">
        <button
          onClick={openLaunch}
          className="flex cursor-pointer items-center gap-1.5 rounded-md bg-accent px-2.5 py-1 text-[12px] font-medium text-ink-50 transition-colors hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring"
          title="Launch a new agent"
        >
          <Plus size={14} strokeWidth={2} />
          Launch
        </button>
        <button
          onClick={openSettings}
          aria-label="Notification settings"
          className="grid h-7 w-7 cursor-pointer place-items-center rounded-md text-ink-400 transition-colors hover:bg-ink-850 hover:text-ink-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring"
          title="Notification settings"
        >
          <Settings size={16} strokeWidth={1.75} />
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
