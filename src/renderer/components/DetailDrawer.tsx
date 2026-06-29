import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { useStore } from '../store/useStore';
import { useNow } from '../lib/useNow';
import { elapsed, formatCost, formatTokens, modelLabel, STATUS_META, sumTokens } from '../lib/format';
import type { CostBreakdown } from '@shared/transcript';
import type { TokenCounts } from '@shared/types';
import TranscriptView from './drawer/TranscriptView';
import SubagentTree from './drawer/SubagentTree';
import Timeline from './drawer/Timeline';

function Section({ title, right, children }: { title: string; right?: string; children: ReactNode }): JSX.Element {
  return (
    <section className="border-t border-ink-800 px-4 py-3.5">
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">{title}</h3>
        {right && <span className="font-mono text-[11px] tabular-nums text-ink-500">{right}</span>}
      </div>
      {children}
    </section>
  );
}

const BUCKETS: Array<{ key: keyof CostBreakdown; tk: keyof TokenCounts; label: string }> = [
  { key: 'input', tk: 'input', label: 'Input' },
  { key: 'output', tk: 'output', label: 'Output' },
  { key: 'cacheWrite', tk: 'cacheWrite', label: 'Cache write' },
  { key: 'cacheRead', tk: 'cacheRead', label: 'Cache read' }
];

function CostBreakdownView({
  cost,
  tokens,
  total
}: {
  cost: CostBreakdown;
  tokens: TokenCounts;
  total: number;
}): JSX.Element {
  const max = Math.max(0.000001, cost.input, cost.output, cost.cacheWrite, cost.cacheRead);
  return (
    <div className="space-y-2">
      {BUCKETS.map((b) => (
        <div key={b.key}>
          <div className="flex items-center justify-between text-[11.5px]">
            <span className="text-ink-100/75">{b.label}</span>
            <span className="text-ink-500">
              <span className="font-mono tabular-nums">{formatTokens(tokens[b.tk])}</span> ·{' '}
              <span className="font-mono tabular-nums text-ink-400">{formatCost(cost[b.key])}</span>
            </span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-ink-800">
            <div
              className="h-full rounded-full bg-accent/70"
              style={{ width: `${Math.min(100, (cost[b.key] / max) * 100)}%` }}
            />
          </div>
        </div>
      ))}
      <div className="flex items-center justify-between border-t border-ink-800 pt-2 text-[12px]">
        <span className="font-medium text-ink-100/85">Total</span>
        <span className="font-mono font-semibold tabular-nums text-ink-100/90">{formatCost(total)}</span>
      </div>
    </div>
  );
}

const OP_BADGE: Record<string, string> = {
  edit: 'text-status-input',
  multiedit: 'text-status-input',
  write: 'text-status-done',
  notebook: 'text-status-busy'
};

export default function DetailDrawer(): JSX.Element | null {
  const sessionId = useStore((s) => s.selectedSessionId);
  const detail = useStore((s) => s.detail);
  const loading = useStore((s) => s.detailLoading);
  const error = useStore((s) => s.detailError);
  const close = useStore((s) => s.closeDrawer);
  const agents = useStore((s) => s.agents);
  const now = useNow(1000);

  useEffect(() => {
    if (!sessionId) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sessionId, close]);

  if (!sessionId) return null;

  const liveAgent = agents?.agents.find((a) => a.sessionId === sessionId);
  const status = liveAgent?.status;
  const meta = status ? STATUS_META[status] : null;
  const busy = status === 'busy';

  const title = detail?.title ?? liveAgent?.title ?? sessionId.slice(0, 8);
  const model = detail?.model ?? liveAgent?.model ?? 'unknown';
  const project = detail?.project ?? liveAgent?.project ?? '';
  const branch = detail?.gitBranch ?? liveAgent?.gitBranch;
  const startedAt = detail?.startedAt ?? liveAgent?.startedAt ?? 0;
  const lastActivityAt = detail?.lastActivityAt ?? liveAgent?.lastActivityAt ?? 0;
  const dur = startedAt ? elapsed(startedAt, busy ? now : lastActivityAt || now) : '—';
  const totalTokens = detail ? sumTokens(detail.tokens) : liveAgent ? sumTokens(liveAgent.tokens) : 0;

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-[1px] drawer-backdrop-in"
        onClick={close}
        aria-hidden
      />

      {/* Panel (floating layer → shadow-float) */}
      <aside
        role="dialog"
        aria-label="Agent transcript detail"
        className="drawer-panel-in relative flex h-full w-full max-w-[620px] flex-col border-l border-ink-700 bg-ink-900 shadow-float"
      >
        {/* Header */}
        <header className="shrink-0 border-b border-ink-800 px-4 py-3">
          <div className="flex items-start gap-2">
            {meta && (
              <span
                className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${meta.dot} ${busy ? 'pulse-dot' : ''}`}
                title={meta.label}
              />
            )}
            <h2 className="min-w-0 flex-1 text-[14px] font-semibold leading-snug text-ink-100/95">
              {title}
            </h2>
            <button
              type="button"
              onClick={close}
              aria-label="Close"
              className="-mr-1 -mt-0.5 grid h-7 w-7 cursor-pointer place-items-center rounded-md text-ink-500 outline-none transition-colors hover:bg-ink-800 hover:text-ink-100/80 focus-visible:ring-2 focus-visible:ring-accent-ring"
            >
              <X size={16} strokeWidth={1.75} />
            </button>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
            {meta && (
              <span className={`rounded border border-ink-700 bg-ink-850 px-1.5 py-0.5 font-medium ${meta.text}`}>
                {meta.label}
              </span>
            )}
            <span className="rounded border border-ink-700 bg-ink-850 px-1.5 py-0.5 font-medium text-ink-100/70">
              {modelLabel(model)}
              {detail?.estimated && <span className="ml-1 text-ink-500" title="estimated pricing">~</span>}
            </span>
            <span className="truncate text-ink-500" title={detail?.cwd}>
              {project}
              {branch && <span className="text-ink-600"> · {branch}</span>}
            </span>
            <span className="ml-auto font-mono tabular-nums text-ink-500" title={`${totalTokens.toLocaleString()} tokens`}>
              {dur} · {formatTokens(totalTokens)} tok
            </span>
          </div>
        </header>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {loading && !detail ? (
            <div className="grid h-40 place-items-center text-[12px] text-ink-500">Loading transcript…</div>
          ) : error ? (
            <div className="grid h-40 place-items-center px-6 text-center text-[12px] text-status-failed">
              {error}
            </div>
          ) : detail?.notFound ? (
            <div className="grid h-40 place-items-center px-6 text-center text-[12px] text-ink-500">
              No transcript file found for this session.
            </div>
          ) : detail ? (
            <>
              <Section title="Cost breakdown">
                <CostBreakdownView cost={detail.costBreakdown} tokens={detail.tokens} total={detail.costUsd} />
              </Section>

              <Section title="Timeline">
                <Timeline
                  events={detail.events}
                  startedAt={detail.startedAt}
                  lastActivityAt={detail.lastActivityAt}
                />
              </Section>

              <Section
                title="Files touched"
                right={detail.filesTouched.length ? `${detail.filesTouched.length}` : undefined}
              >
                {detail.filesTouched.length === 0 ? (
                  <p className="text-[11.5px] text-ink-600">No files were created or edited.</p>
                ) : (
                  <ul className="space-y-1">
                    {detail.filesTouched.map((f) => (
                      <li key={f.path} className="flex items-center gap-2 text-[12px]" title={f.path}>
                        <span className={`w-16 shrink-0 text-[10px] uppercase ${OP_BADGE[f.op] ?? 'text-ink-500'}`}>
                          {f.op}
                        </span>
                        <span className="min-w-0 flex-1 truncate font-mono text-ink-100/80">{f.name}</span>
                        {f.count > 1 && <span className="text-[10.5px] text-ink-600">×{f.count}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </Section>

              <Section
                title="Subagents"
                right={detail.subagents.length ? `${detail.subagents.length}` : undefined}
              >
                <SubagentTree subagents={detail.subagents} />
              </Section>

              <Section title="Transcript" right={`${detail.totalEvents} events`}>
                <TranscriptView
                  events={detail.events}
                  truncated={detail.truncated}
                  totalEvents={detail.totalEvents}
                />
              </Section>
            </>
          ) : null}
        </div>
      </aside>
    </div>
  );
}
