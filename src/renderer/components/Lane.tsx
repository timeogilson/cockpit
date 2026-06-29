import type { Agent, AgentStatus } from '@shared/types';
import { STATUS_META } from '../lib/format';
import AgentCard from './AgentCard';

const EMPTY_COPY: Record<AgentStatus, string> = {
  busy: 'No agents running right now.',
  'needs-input': 'Nothing waiting on you.',
  done: 'No finished sessions yet.',
  failed: 'No failures — all clear.',
  idle: 'No idle workers.'
};

export default function Lane({
  status,
  agents,
  now
}: {
  status: AgentStatus;
  agents: Agent[];
  now: number;
}): JSX.Element {
  const meta = STATUS_META[status];

  return (
    <section className="flex h-full min-w-[230px] flex-1 flex-col">
      <header className="mb-2 flex items-center gap-2 px-0.5">
        <span className={`h-2 w-2 rounded-full ${meta.dot}`} />
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">
          {meta.label}
        </h2>
        <span className="rounded-full bg-ink-800 px-1.5 text-[11px] font-medium tabular-nums text-ink-400">
          {agents.length}
        </span>
      </header>

      <div className="flex flex-1 flex-col gap-2 overflow-y-auto pr-1">
        {agents.length === 0 ? (
          <div className="grid flex-1 place-items-center rounded-lg border border-dashed border-ink-700/60 px-3 py-8 text-center text-[11.5px] text-ink-500">
            {EMPTY_COPY[status]}
          </div>
        ) : (
          agents.map((a) => <AgentCard key={a.sessionId} agent={a} now={now} />)
        )}
      </div>
    </section>
  );
}
