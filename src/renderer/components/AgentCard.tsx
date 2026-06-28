import type { Agent } from '@shared/types';
import { elapsed, formatCost, formatTokens, modelLabel, relativeTime, STATUS_META, sumTokens } from '../lib/format';
// M3 (additive): clicking a card opens the detail drawer.
import { useStore } from '../store/useStore';

export default function AgentCard({ agent, now }: { agent: Agent; now: number }): JSX.Element {
  const meta = STATUS_META[agent.status];
  const tokens = sumTokens(agent.tokens);
  // M3 (additive): open the transcript drawer for this session.
  const openAgent = useStore((s) => s.openAgent);
  const selected = useStore((s) => s.selectedSessionId === agent.sessionId);

  return (
    <article
      onClick={() => void openAgent(agent.sessionId)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          void openAgent(agent.sessionId);
        }
      }}
      role="button"
      tabIndex={0}
      aria-label={`Open transcript: ${agent.title}`}
      className={`group cursor-pointer rounded-lg border bg-ink-850 p-3 shadow-card outline-none transition-colors hover:border-ink-600 focus-visible:ring-2 focus-visible:ring-accent/40 ${
        selected ? 'border-accent/60 ring-1 ring-accent/30' : 'border-ink-700/70'
      }`}
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
    </article>
  );
}
