import { useStore } from '../../store/useStore';
import { useSessionStore } from '../../store/useSessionStore';
import { STATUS_META, modelLabel } from '../../lib/format';

/**
 * SessionsSidebar — the left column. Two groups:
 *   • "Running here" — live PTY sessions Cockpit spawned (selectable, stoppable).
 *   • "Observed"     — external sessions from the engine snapshot (read-only).
 */

function GroupHeader({ children }: { children: string }): JSX.Element {
  return (
    <p className="px-2 pb-1.5 pt-3 text-[10.5px] font-semibold uppercase tracking-wide text-ink-600">
      {children}
    </p>
  );
}

const chipCls =
  'shrink-0 rounded border border-ink-700 bg-ink-850 px-1.5 text-[10px] text-ink-100/70';

export default function SessionsSidebar({
  onNewSession
}: {
  onNewSession: () => void;
}): JSX.Element {
  const runningHere = useSessionStore((s) => s.runningHere);
  const selected = useSessionStore((s) => s.selected);
  const selectPty = useSessionStore((s) => s.selectPty);
  const selectObserved = useSessionStore((s) => s.selectObserved);
  const stopSession = useSessionStore((s) => s.stopSession);
  const removeSession = useSessionStore((s) => s.removeSession);
  const agents = useStore((s) => s.agents);

  const observed = agents?.agents ?? [];

  return (
    <aside className="flex w-64 shrink-0 flex-col rounded-lg border border-ink-700/70 bg-ink-900">
      <div className="border-b border-ink-800 p-2.5">
        <button
          onClick={onNewSession}
          className="w-full rounded-md bg-accent px-2.5 py-1.5 text-[12.5px] font-medium text-white transition-colors hover:bg-accent-soft"
          title="Start a new claude session"
        >
          + New session
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-3">
        <GroupHeader>Running here</GroupHeader>
        {runningHere.length === 0 ? (
          <p className="px-2 py-1 text-[11.5px] text-ink-600">No live sessions yet.</p>
        ) : (
          <ul className="space-y-0.5">
            {runningHere.map((s) => {
              const active = selected?.kind === 'pty' && selected.id === s.id;
              const running = s.status === 'running';
              return (
                <li key={s.id}>
                  <button
                    onClick={() => selectPty(s.id)}
                    className={[
                      'group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors',
                      active ? 'bg-ink-750' : 'hover:bg-ink-850'
                    ].join(' ')}
                  >
                    <span
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                        running ? 'bg-status-busy pulse-dot' : 'bg-status-idle'
                      }`}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] text-ink-100/90">{s.title}</span>
                      <span className="block truncate text-[10.5px] text-ink-600">{s.project}</span>
                    </span>
                    {s.model && <span className={chipCls}>{s.model}</span>}
                    {running ? (
                      <span
                        role="button"
                        tabIndex={-1}
                        onClick={(e) => {
                          e.stopPropagation();
                          stopSession(s.id);
                        }}
                        className="shrink-0 rounded px-1.5 py-0.5 text-[10.5px] text-ink-500 hover:bg-ink-800 hover:text-status-failed"
                        title="Stop this session"
                      >
                        Stop
                      </span>
                    ) : (
                      <span
                        role="button"
                        tabIndex={-1}
                        onClick={(e) => {
                          e.stopPropagation();
                          removeSession(s.id);
                        }}
                        className="shrink-0 rounded px-1.5 py-0.5 text-[10.5px] text-ink-500 hover:bg-ink-800 hover:text-ink-100/80"
                        title="Remove this session"
                      >
                        ✕
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <GroupHeader>Observed</GroupHeader>
        {observed.length === 0 ? (
          <p className="px-2 py-1 text-[11.5px] text-ink-600">No external sessions.</p>
        ) : (
          <ul className="space-y-0.5">
            {observed.map((a) => {
              const active = selected?.kind === 'observed' && selected.sessionId === a.sessionId;
              return (
                <li key={a.sessionId}>
                  <button
                    onClick={() => selectObserved(a.sessionId)}
                    className={[
                      'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors',
                      active ? 'bg-ink-750' : 'hover:bg-ink-850'
                    ].join(' ')}
                  >
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_META[a.status].dot}`} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] text-ink-100/90">{a.title}</span>
                      <span className="block truncate text-[10.5px] text-ink-600">{a.project}</span>
                    </span>
                    <span className={chipCls}>{modelLabel(a.model)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}
