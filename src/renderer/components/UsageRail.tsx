import { ChartColumn } from 'lucide-react';
import type { UsageWindow } from '@shared/types';
import { useStore } from '../store/useStore';
import {
  formatCost,
  formatPct,
  formatRate,
  formatTokens,
  modelLabel,
  sumTokens
} from '../lib/format';

export default function UsageRail(): JSX.Element {
  const usage = useStore((s) => s.usage);
  const a = usage?.analytics;

  // Prefer the richer roller "today"; fall back to the engine's today.
  const todayCost = a?.today.costUsd ?? usage?.today.costUsd ?? 0;
  const todayTokens = a?.today.tokens ?? usage?.today.tokens;
  const todayEstimated = a?.today.estimated ?? usage?.today.estimated ?? false;
  const totalToday = todayTokens ? sumTokens(todayTokens) : 0;

  // By-model list (prefer roller breakdown; fall back to engine byModel).
  const models =
    a?.byModel.map((m) => ({ label: m.key, costUsd: m.costUsd, estimated: m.estimated })) ??
    usage?.byModel.map((m) => ({ label: m.model, costUsd: m.costUsd, estimated: m.estimated })) ??
    [];
  const maxModelCost = Math.max(0.0001, ...models.map((m) => m.costUsd), 0);

  return (
    <aside className="flex w-64 shrink-0 flex-col border-l border-ink-700/70 bg-ink-900 shadow-rail">
      <div className="flex items-center gap-1.5 border-b border-ink-700/60 px-4 py-3">
        <ChartColumn size={14} strokeWidth={1.75} className="text-ink-400" />
        <h2 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-500">Usage</h2>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-5">
        <section>
          <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-500">Today</p>
          <p className="mt-1.5 font-mono text-2xl font-semibold tabular-nums text-ink-50">
            {formatCost(todayCost)}
            {todayEstimated && (
              <span className="ml-1 align-top text-xs text-ink-500" title="includes estimated pricing">
                ~
              </span>
            )}
          </p>
          <p className="mt-1 font-mono text-[11px] tabular-nums text-ink-500">
            {formatTokens(totalToday)} tokens
          </p>
        </section>

        <section className="mt-4 grid grid-cols-2 gap-2">
          <Stat label="In" value={formatTokens(todayTokens?.input ?? 0)} />
          <Stat label="Out" value={formatTokens(todayTokens?.output ?? 0)} />
          <Stat label="Cache w" value={formatTokens(todayTokens?.cacheWrite ?? 0)} />
          <Stat label="Cache r" value={formatTokens(todayTokens?.cacheRead ?? 0)} />
        </section>

        {a && (
          <section className="mt-5 space-y-2.5">
            <WindowBar label="5h window" win={a.window5h} />
            <WindowBar label="This week" win={a.week} />
          </section>
        )}

        {a && (
          <section className="mt-5 grid grid-cols-2 gap-2">
            <Stat label="Burn rate" value={formatRate(a.burnRatePerHour)} accent />
            <Stat label="Proj. month" value={formatCost(a.projectedMonth)} accent />
          </section>
        )}

        {a && a.cache.cacheReadTokens > 0 && (
          <section className="mt-3 rounded-md border border-ink-700/60 bg-ink-850 px-2.5 py-2">
            <div className="flex items-center justify-between text-[11px]">
              <span className="uppercase tracking-[0.08em] text-ink-500">Cache hit</span>
              <span className="font-mono tabular-nums text-status-done">
                {formatPct(a.cache.efficiency)}
              </span>
            </div>
            <p className="mt-0.5 text-[10.5px] text-ink-500">
              saved{' '}
              <span className="font-mono tabular-nums text-ink-200">
                {formatCost(a.cache.savedUsd)}
              </span>
            </p>
          </section>
        )}

        <section className="mt-6">
          <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.08em] text-ink-500">
            By model
          </p>
          {models.length > 0 ? (
            <ul className="space-y-2.5">
              {models.slice(0, 5).map((m) => (
                <li key={m.label}>
                  <div className="flex items-center justify-between text-[11.5px]">
                    <span className="truncate text-ink-200">
                      {modelLabel(m.label)}
                      {m.estimated && <span className="ml-1 text-ink-500">~</span>}
                    </span>
                    <span className="font-mono tabular-nums text-ink-400">
                      {formatCost(m.costUsd)}
                    </span>
                  </div>
                  <div className="mt-1 h-1 overflow-hidden rounded-full bg-ink-800">
                    <div
                      className="h-full rounded-full bg-accent"
                      style={{ width: `${Math.min(100, (m.costUsd / maxModelCost) * 100)}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[11.5px] text-ink-500">No spend recorded yet.</p>
          )}
        </section>

        <p className="mt-6 text-[10px] leading-relaxed text-ink-500">
          Cost is derived from token counts × an editable pricing table. Open the Usage tab for
          charts, per-project breakdowns, and the activity heatmap.
        </p>
      </div>
    </aside>
  );
}

function WindowBar({ label, win }: { label: string; win: UsageWindow }): JSX.Element {
  const pct = win.pctOfCap;
  const over = pct !== undefined && pct >= 1;
  const near = pct !== undefined && pct >= 0.8 && pct < 1;
  const barColor = over ? 'bg-status-failed' : near ? 'bg-status-needs' : 'bg-accent';
  return (
    <div>
      <div className="flex items-center justify-between text-[11.5px]">
        <span className="text-ink-200">{label}</span>
        <span className="font-mono tabular-nums text-ink-400">
          {formatCost(win.costUsd)}
          {win.estimated && <span className="ml-0.5 text-ink-500">~</span>}
          {pct !== undefined && (
            <span className={`ml-1 ${over ? 'text-status-failed' : 'text-ink-500'}`}>
              {formatPct(pct)}
            </span>
          )}
        </span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-ink-800">
        <div
          className={`h-full rounded-full ${barColor}`}
          style={{ width: pct !== undefined ? `${Math.min(100, pct * 100)}%` : '100%', opacity: pct !== undefined ? 1 : 0.25 }}
        />
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  accent
}: {
  label: string;
  value: string;
  accent?: boolean;
}): JSX.Element {
  return (
    <div className="rounded-md border border-ink-700/60 bg-ink-850 px-2.5 py-1.5">
      <p className="text-[10px] uppercase tracking-[0.08em] text-ink-500">{label}</p>
      <p className={`font-mono text-[13px] tabular-nums ${accent ? 'text-accent' : 'text-ink-100'}`}>
        {value}
      </p>
    </div>
  );
}
