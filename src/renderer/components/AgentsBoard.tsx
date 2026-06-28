import type { AgentStatus } from '@shared/types';
import { useStore } from '../store/useStore';
import { useNow } from '../lib/useNow';
import Lane from './Lane';

const LANES: AgentStatus[] = ['busy', 'needs-input', 'done', 'failed', 'idle'];

export default function AgentsBoard(): JSX.Element {
  const agents = useStore((s) => s.agents);
  const now = useNow(1000);

  const list = agents?.agents ?? [];

  if (!agents) {
    return (
      <div className="grid h-full place-items-center text-sm text-ink-500">
        Connecting to the engine…
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="mb-3 flex items-baseline gap-3">
        <h1 className="text-[15px] font-semibold text-ink-100/90">Agents</h1>
        <span className="text-xs text-ink-500">
          {agents.activeWorkers} active · {agents.scannedSessions} recent session
          {agents.scannedSessions === 1 ? '' : 's'}
        </span>
      </div>

      <div className="flex flex-1 gap-3 overflow-hidden">
        {LANES.map((status) => (
          <Lane
            key={status}
            status={status}
            now={now}
            agents={list.filter((a) => a.status === status)}
          />
        ))}
      </div>
    </div>
  );
}
