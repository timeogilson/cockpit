import { ChevronRight, CornerDownLeft, Cpu, Folder, GitBranch, Square } from 'lucide-react';
import type { Agent } from '@shared/types';
import { elapsed, formatCost, formatTokens, modelLabel, relativeTime, STATUS_META, sumTokens } from '../lib/format';
// M3 (additive): clicking a card opens the detail drawer.
import { useStore } from '../store/useStore';
// M4 (additive): per-agent control actions via the separate control store.
import { useControlStore } from '../store/useControlStore';

export default function AgentCard({ agent, now }: { agent: Agent; now: number }): JSX.Element {
  const meta = STATUS_META[agent.status];
  const tokens = sumTokens(agent.tokens);
  // M3 (additive): open the transcript drawer for this session.
  const openAgent = useStore((s) => s.openAgent);
  const selected = useStore((s) => s.selectedSessionId === agent.sessionId);
  // M4: control actions (additive — wired through the separate control store).
  const stop = useControlStore((s) => s.stop);
  const openFollowUp = useControlStore((s) => s.openFollowUp);
  const canStop = agent.status === 'busy' || agent.status === 'idle' || agent.status === 'needs-input';
  const StatusIcon = meta.icon;

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
      className={`group cursor-pointer rounded-lg border bg-ink-850 p-3 outline-none transition-colors hover:border-ink-600 focus-visible:ring-2 focus-visible:ring-accent/40 ${
        selected ? 'border-accent ring-1 ring-accent/40' : 'border-ink-700/60'
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
        <span
          className={`inline-flex items-center gap-1 rounded-md border border-ink-700 bg-ink-800 px-1.5 py-0.5 text-[10.5px] font-medium ${meta.text}`}
        >
          <StatusIcon
            size={11}
            strokeWidth={1.75}
            className={agent.status === 'busy' ? 'animate-spin motion-reduce:animate-none' : ''}
          />
          {meta.label}
        </span>
        <span className="inline-flex items-center gap-1 rounded-md border border-ink-700 bg-ink-800 px-1.5 py-0.5 font-mono text-[10.5px] font-medium text-ink-100/70">
          <Cpu size={11} strokeWidth={1.75} className="text-ink-400" />
          {modelLabel(agent.model)}
          {agent.estimated && <span className="ml-0.5 text-ink-500" title="estimated pricing">~</span>}
        </span>
        <span className="inline-flex min-w-0 items-center gap-1 text-[11px] text-ink-500" title={agent.cwd}>
          <Folder size={11} strokeWidth={1.75} className="shrink-0 text-ink-400" />
          <span className="truncate">{agent.project}</span>
          {agent.gitBranch && (
            <span className="inline-flex min-w-0 items-center gap-1">
              <GitBranch size={11} strokeWidth={1.75} className="shrink-0 text-ink-400" />
              <span className="truncate">{agent.gitBranch}</span>
            </span>
          )}
        </span>
      </div>

      {agent.activityLine && (
        <p className="mt-2 flex items-center gap-1 truncate text-[11.5px] text-ink-100/60">
          <ChevronRight size={12} strokeWidth={1.75} className={`shrink-0 ${meta.text}`} />
          <span className="truncate">{agent.activityLine}</span>
        </p>
      )}

      <div className="mt-2.5 flex items-center justify-between border-t border-ink-800 pt-2 text-[11px] text-ink-500">
        <span title={`started ${new Date(agent.startedAt).toLocaleString()}`}>
          {agent.status === 'busy'
            ? `active ${relativeTime(agent.lastActivityAt, now)} ago`
            : `${elapsed(agent.startedAt, agent.lastActivityAt)} · ${relativeTime(agent.lastActivityAt, now)} ago`}
        </span>
        <span className="font-mono tabular-nums text-ink-100/70" title={`${tokens.toLocaleString()} tokens`}>
          {formatCost(agent.costUsd)}
          <span className="ml-1 text-ink-500">{formatTokens(tokens)}</span>
        </span>
      </div>

      {/* M4: per-agent control actions (revealed on hover). */}
      <div className="mt-2 flex items-center gap-1.5 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          onClick={(e) => {
            e.stopPropagation();
            openFollowUp(agent.sessionId, agent.title);
          }}
          className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-ink-700 px-2 py-0.5 text-[10.5px] text-ink-100/70 outline-none transition-colors hover:border-ink-600 hover:text-ink-100/90 focus-visible:ring-2 focus-visible:ring-accent-ring"
          title="Resume this session with a follow-up message"
        >
          <CornerDownLeft size={11} strokeWidth={1.75} />
          Follow up
        </button>
        {canStop && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              stop({ pid: agent.pid, sessionId: agent.sessionId }, agent.title);
            }}
            disabled={!agent.pid}
            className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-ink-700 px-2 py-0.5 text-[10.5px] text-ink-100/70 outline-none transition-colors hover:border-status-failed/60 hover:text-status-failed focus-visible:ring-2 focus-visible:ring-accent-ring disabled:cursor-not-allowed disabled:opacity-40"
            title={agent.pid ? 'Tree-kill this agent process' : 'No live pid to stop'}
          >
            <Square size={11} strokeWidth={1.75} />
            Stop
          </button>
        )}
      </div>
    </article>
  );
}
