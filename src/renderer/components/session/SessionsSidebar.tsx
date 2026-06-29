import { useMemo, useRef } from 'react';
import type { Agent, AgentStatus } from '@shared/types';
import { useStore } from '../../store/useStore';
import { useSessionStore, type PtyStatus } from '../../store/useSessionStore';
import { STATUS_META, modelLabel, relativeTime } from '../../lib/format';
import { useNow } from '../../lib/useNow';

/**
 * SessionsSidebar — the left column.
 *
 *   • "Running here" — live PTY sessions Cockpit spawned (selectable, stoppable).
 *   • "Observed"     — external sessions from the engine snapshot (read-only),
 *     split into "Needs you" / "Active" / "Recent" and DETERMINISTICALLY sorted
 *     so rows don't reorder/flicker between 3–5s scans. The currently-selected
 *     observed row is always kept visible even if it drops out of the scan window.
 */

function GroupHeader({
  children,
  accent,
  count
}: {
  children: string;
  accent?: boolean;
  count?: number;
}): JSX.Element {
  return (
    <p
      className={[
        'flex items-center gap-1.5 px-2 pb-1.5 pt-3 text-[10.5px] font-semibold uppercase tracking-wide',
        accent ? 'text-status-input' : 'text-ink-600'
      ].join(' ')}
    >
      {accent && <span className="h-1 w-1 rounded-full bg-status-input" />}
      <span>{children}</span>
      {typeof count === 'number' && count > 0 && (
        <span className="font-normal normal-case text-ink-600">· {count}</span>
      )}
    </p>
  );
}

const chipCls =
  'shrink-0 rounded border border-ink-700 bg-ink-850 px-1.5 text-[10px] text-ink-100/70';

/** In-app PTY status → dot color + short label. */
const PTY_META: Record<PtyStatus, { label: string; dot: string; pulse: boolean }> = {
  starting: { label: 'starting', dot: 'bg-status-busy', pulse: false },
  running: { label: 'running', dot: 'bg-status-busy', pulse: true },
  exited: { label: 'exited', dot: 'bg-status-idle', pulse: false },
  failed: { label: 'failed', dot: 'bg-status-failed', pulse: false }
};

/** Observed (engine) status → short textual label shown next to the dot. */
const OBSERVED_LABEL: Record<AgentStatus, string> = {
  'needs-input': 'needs you',
  busy: 'running',
  idle: 'idle',
  done: 'done',
  failed: 'failed'
};

/** Deterministic status priority for sorting (lower = higher in the list). */
const STATUS_PRIORITY: Record<AgentStatus, number> = {
  'needs-input': 0,
  busy: 1,
  idle: 2,
  done: 3,
  failed: 4
};

const RECENT_CAP = 8;

/** Selectable left-accent classes (transparent border reserved → no shift). */
function rowCls(active: boolean): string {
  return [
    'group flex w-full items-center gap-2 rounded-md border-l-2 px-2 py-1.5 text-left transition-colors',
    active ? 'border-accent bg-ink-750' : 'border-transparent hover:bg-ink-850'
  ].join(' ');
}

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
  const now = useNow(15000);

  const observedRaw = agents?.agents;
  const selectedObservedId = selected?.kind === 'observed' ? selected.sessionId : null;

  // Cache of the last-known Agent object per sessionId, so a selected session
  // that ages out of the engine's recent window doesn't vanish from the list.
  const seenRef = useRef<Map<string, Agent>>(new Map());

  const { needsYou, activeList, recent, recentHidden } = useMemo(() => {
    const observed = observedRaw ?? [];
    const seen = seenRef.current;
    for (const a of observed) seen.set(a.sessionId, a);

    // Best-effort de-dupe: hide an observed session whose cwd matches a live
    // in-app PTY (it's almost certainly the same session shown under Running here).
    const liveCwds = new Set(
      runningHere
        .filter((r) => r.status === 'running' || r.status === 'starting')
        .map((r) => r.cwd)
    );
    let pool = observed.filter((a) => !liveCwds.has(a.cwd));

    // Keep the selected observed row present even if it dropped from the scan.
    if (selectedObservedId && !pool.some((a) => a.sessionId === selectedObservedId)) {
      const recovered = seen.get(selectedObservedId);
      if (recovered && !liveCwds.has(recovered.cwd)) pool = [...pool, recovered];
    }

    const byRecency = (a: Agent, b: Agent): number =>
      (b.lastActivityAt || b.startedAt || 0) - (a.lastActivityAt || a.startedAt || 0);
    const byStatusThenRecency = (a: Agent, b: Agent): number =>
      STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status] || byRecency(a, b);

    const needsYou = pool.filter((a) => a.status === 'needs-input').sort(byRecency);
    const activeList = pool
      .filter((a) => a.status === 'busy' || a.status === 'idle')
      .sort(byStatusThenRecency);
    const recentAll = pool
      .filter((a) => a.status === 'done' || a.status === 'failed')
      .sort(byRecency);

    return {
      needsYou,
      activeList,
      recent: recentAll.slice(0, RECENT_CAP),
      recentHidden: Math.max(0, recentAll.length - RECENT_CAP)
    };
  }, [observedRaw, runningHere, selectedObservedId]);

  const observedEmpty =
    needsYou.length === 0 && activeList.length === 0 && recent.length === 0;

  const renderObserved = (a: Agent): JSX.Element => {
    const isActive = selectedObservedId === a.sessionId;
    const meta = STATUS_META[a.status];
    return (
      <li key={a.sessionId}>
        <button onClick={() => selectObserved(a.sessionId)} className={rowCls(isActive)}>
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${meta.dot}`} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12.5px] text-ink-100/90">{a.title}</span>
            <span className="block truncate text-[10.5px] text-ink-600">
              <span className={meta.text}>{OBSERVED_LABEL[a.status]}</span>
              {a.project ? <span> · {a.project}</span> : null}
              <span> · {relativeTime(a.lastActivityAt || a.startedAt, now)}</span>
            </span>
          </span>
          <span className={chipCls}>{modelLabel(a.model)}</span>
        </button>
      </li>
    );
  };

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
              const meta = PTY_META[s.status];
              const running = s.status === 'running';
              return (
                <li key={s.id}>
                  <button onClick={() => selectPty(s.id)} className={rowCls(active)}>
                    <span
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${meta.dot} ${
                        meta.pulse ? 'pulse-dot' : ''
                      }`}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] text-ink-100/90">{s.title}</span>
                      <span className="block truncate text-[10.5px] text-ink-600">
                        <span className={s.status === 'failed' ? 'text-status-failed' : undefined}>
                          {meta.label}
                        </span>
                        {s.project ? <span> · {s.project}</span> : null}
                      </span>
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

        {observedEmpty ? (
          <>
            <GroupHeader>Observed</GroupHeader>
            <p className="px-2 py-1 text-[11.5px] text-ink-600">No external sessions.</p>
          </>
        ) : (
          <>
            {needsYou.length > 0 && (
              <>
                <GroupHeader accent count={needsYou.length}>
                  Needs you
                </GroupHeader>
                <ul className="space-y-0.5">{needsYou.map(renderObserved)}</ul>
              </>
            )}

            {activeList.length > 0 && (
              <>
                <GroupHeader count={activeList.length}>Active</GroupHeader>
                <ul className="space-y-0.5">{activeList.map(renderObserved)}</ul>
              </>
            )}

            {recent.length > 0 && (
              <>
                <GroupHeader count={recent.length + recentHidden}>Recent</GroupHeader>
                <ul className="space-y-0.5 opacity-70">{recent.map(renderObserved)}</ul>
                {recentHidden > 0 && (
                  <p className="px-2 pt-1 text-[10.5px] text-ink-600">+{recentHidden} more</p>
                )}
              </>
            )}
          </>
        )}
      </div>
    </aside>
  );
}
