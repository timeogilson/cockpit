import type { Agent } from '@shared/types';
import { elapsed, formatCost, formatTokens, modelLabel, relativeTime, STATUS_META, sumTokens } from '../lib/format';
import { useControlStore } from '../store/useControlStore';

export default function AgentCard({ agent, now }: { agent: Agent; now: number }): JSX.Element {
  const meta = STATUS_META[agent.status];
  const tokens = sumTokens(agent.tokens);
  // M4: control actions (additive — wired through the separate control store).
  const stop = useControlStore((s) => s.stop);
  const openFollowUp = useControlStore((s) => s.openFollowUp);
  const canStop = agent.status === 'busy' || agent.status === 'idle' || agent.status === 'needs-input';

  return (
    <article
      className="group rounded-lg border border-ink-700/70 bg-ink-850 p-3 shadow-card transition-colors hover:border-ink-600"
    >
      <div className="flex items-start gap-2">
        <span
          className={`mt-1 h-2 w-2 shrink-0 rounded-full ${meta.dot} ${
            agent.status === 'busy' ? 'pulse-dot' : ''
          }`}
          title={meta.label}
        />
        <h3 className="line-clamp-2 text-[13px] font-medium leading-snug text-ink-100/95">
          {agent.title}
        </h3>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="rounded border border-ink-700 bg-ink-800 px-1.5 py-0.5 text-[10.5px] font-medium text-ink-100/70">
          {modelLabel(agent.model)}
          {agent.estimated && <span className="ml-1 text-ink-600" title="estimated pricing">~</span>}
        </span>
        <span className="truncate text-[11px] text-ink-500" title={agent.cwd}>
          {agent.project}
          {agent.gitBranch && <span className="text-ink-600"> · {agent.gitBranch}</span>}
        </span>
      </div>

      {agent.activityLine && (
        <p className="mt-2 truncate text-[11.5px] text-ink-100/60">
          <span className={`${meta.text}`}>›</span> {agent.activityLine}
        </p>
      )}

      <div className="mt-2.5 flex items-center justify-between border-t border-ink-800 pt-2 text-[11px] text-ink-500">
        <span title={`started ${new Date(agent.startedAt).toLocaleString()}`}>
          {agent.status === 'busy'
            ? `active ${relativeTime(agent.lastActivityAt, now)} ago`
            : `${elapsed(agent.startedAt, agent.lastActivityAt)} · ${relativeTime(agent.lastActivityAt, now)} ago`}
        </span>
        <span className="font-mono text-ink-100/70" title={`${tokens.toLocaleString()} tokens`}>
          {formatCost(agent.costUsd)}
          <span className="ml-1 text-ink-600">{formatTokens(tokens)}</span>
        </span>
      </div>

      {/* M4: per-agent control actions (revealed on hover). */}
      <div className="mt-2 flex items-center gap-1.5 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          onClick={() => openFollowUp(agent.sessionId, agent.title)}
          className="rounded border border-ink-700 px-2 py-0.5 text-[10.5px] text-ink-100/70 hover:border-ink-600 hover:text-ink-100/90"
          title="Resume this session with a follow-up message"
        >
          Follow up
        </button>
        {canStop && (
          <button
            onClick={() =>
              stop({ pid: agent.pid, sessionId: agent.sessionId }, agent.title)
            }
            disabled={!agent.pid}
            className="rounded border border-ink-700 px-2 py-0.5 text-[10.5px] text-ink-100/70 hover:border-status-failed/60 hover:text-status-failed disabled:cursor-not-allowed disabled:opacity-40"
            title={agent.pid ? 'Tree-kill this agent process' : 'No live pid to stop'}
          >
            Stop
          </button>
        )}
      </div>
    </article>
  );
}
