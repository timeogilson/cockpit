import type { TranscriptEvent } from '@shared/transcript';
import { elapsed } from '../../lib/format';

const TICK_COLOR: Record<TranscriptEvent['kind'], string> = {
  user: 'bg-status-busy',
  assistant: 'bg-accent',
  system: 'bg-ink-600',
  tool: 'bg-status-done'
};

/** Max ticks rendered, to keep dense transcripts cheap to paint. */
const MAX_TICKS = 500;

/**
 * A simple proportional timeline: each event is a tick placed by its timestamp
 * between the session start and last activity. Conveys cadence/density at a glance.
 */
export default function Timeline({
  events,
  startedAt,
  lastActivityAt
}: {
  events: TranscriptEvent[];
  startedAt: number;
  lastActivityAt: number;
}): JSX.Element {
  const timed = events.filter((e) => e.timestamp > 0).slice(0, MAX_TICKS);
  const span = Math.max(1, lastActivityAt - startedAt);

  if (timed.length === 0) {
    return <p className="text-[11.5px] text-ink-600">No timestamped events.</p>;
  }

  return (
    <div>
      <div className="relative h-9 overflow-hidden rounded-md border border-ink-800 bg-ink-900/60">
        {timed.map((e, i) => {
          const pct = ((e.timestamp - startedAt) / span) * 100;
          return (
            <span
              key={e.uuid ?? i}
              className={`absolute top-1 h-7 w-px ${TICK_COLOR[e.kind]} opacity-70`}
              style={{ left: `${Math.min(100, Math.max(0, pct))}%` }}
              title={`${e.kind} · ${new Date(e.timestamp).toLocaleTimeString()}`}
            />
          );
        })}
      </div>
      <div className="mt-1 flex justify-between font-mono text-[10px] tabular-nums text-ink-500">
        <span>{startedAt ? new Date(startedAt).toLocaleTimeString() : '—'}</span>
        <span>{startedAt && lastActivityAt ? elapsed(startedAt, lastActivityAt) : ''}</span>
        <span>{lastActivityAt ? new Date(lastActivityAt).toLocaleTimeString() : '—'}</span>
      </div>
    </div>
  );
}
