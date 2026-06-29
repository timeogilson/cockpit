import { useEffect, useState } from 'react';
import { SquareTerminal } from 'lucide-react';
import type { TranscriptDetail } from '@shared/transcript';
import { useSessionStore } from '../../store/useSessionStore';
import TerminalPane from './TerminalPane';
import TranscriptView from '../drawer/TranscriptView';

/**
 * SessionCenter — the middle column. Every live PTY terminal stays mounted at
 * once; the non-selected ones are merely CSS-hidden (never unmounted until the
 * session is removed) so their xterm state survives session switches. An
 * observed/external session instead renders a read-only transcript fetched on
 * demand.
 */

export default function SessionCenter(): JSX.Element {
  const runningHere = useSessionStore((s) => s.runningHere);
  const selected = useSessionStore((s) => s.selected);

  const isSelectedPty = (id: string): boolean =>
    selected?.kind === 'pty' && selected.id === id;

  return (
    <div className="relative flex h-full min-h-0 flex-1 flex-col">
      {/* Live terminals — all mounted, only the selected one visible. */}
      {runningHere.map((s) => (
        <div key={s.id} className={isSelectedPty(s.id) ? 'h-full min-h-0' : 'hidden'}>
          <TerminalPane session={s} active={isSelectedPty(s.id)} />
        </div>
      ))}

      {/* Observed/external session — read-only transcript. */}
      {selected?.kind === 'observed' && <ObservedTranscript sessionId={selected.sessionId} />}

      {/* Nothing selected. */}
      {selected === null && (
        <div className="grid h-full place-items-center px-8 text-center">
          <div className="max-w-sm">
            <SquareTerminal
              size={28}
              strokeWidth={1.5}
              className="mx-auto mb-3 text-ink-600"
            />
            <p className="text-[13px] font-medium text-ink-100">No session selected</p>
            <p className="mt-1.5 text-[12px] leading-relaxed text-ink-500">
              Start a live <span className="text-accent">claude</span> session with
              <span className="mx-1 rounded border border-ink-700 bg-ink-850 px-1.5 py-0.5 text-[11px] text-ink-100">
                New session
              </span>
              , or pick an observed session from the sidebar to read its transcript.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

/** Read-only transcript for a session running OUTSIDE Cockpit. */
function ObservedTranscript({ sessionId }: { sessionId: string }): JSX.Element {
  const [detail, setDetail] = useState<TranscriptDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setError(null);
    setLoading(true);
    const api = window.cockpit;
    if (!api) {
      setLoading(false);
      setError('Bridge unavailable.');
      return;
    }
    void (async () => {
      try {
        const d = await api.invoke('transcript:get', { sessionId });
        if (cancelled) return;
        setDetail(d);
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        console.error('[session] transcript:get failed:', err);
        setError('Failed to load transcript.');
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  return (
    <div className="flex h-full min-h-0 flex-col rounded-lg border border-ink-700/70 bg-ink-950">
      <header className="shrink-0 border-b border-ink-700/60 bg-ink-900 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-status-idle" />
          <span className="truncate text-[13px] font-medium text-ink-100">
            {detail?.title ?? 'Transcript'}
          </span>
          <span className="ml-auto text-[10.5px] uppercase tracking-[0.08em] text-ink-500">
            read-only — started outside Cockpit
          </span>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {loading && !detail ? (
          <div className="grid h-40 place-items-center text-[12px] text-ink-500">
            Loading transcript…
          </div>
        ) : error ? (
          <div className="grid h-40 place-items-center px-6 text-center text-[12px] text-status-failed">
            {error}
          </div>
        ) : detail?.notFound ? (
          <div className="grid h-40 place-items-center px-6 text-center text-[12px] text-ink-500">
            No transcript file found for this session.
          </div>
        ) : detail ? (
          <TranscriptView
            events={detail.events}
            truncated={detail.truncated}
            totalEvents={detail.totalEvents}
          />
        ) : null}
      </div>
    </div>
  );
}
