import { useStore } from '../store/useStore';
import { formatCost, formatTokens, modelLabel, sumTokens } from '../lib/format';

export default function UsageRail(): JSX.Element {
  const usage = useStore((s) => s.usage);

  const today = usage?.today;
  const totalToday = today ? sumTokens(today.tokens) : 0;
  const maxModelCost = Math.max(0.0001, ...(usage?.byModel.map((m) => m.costUsd) ?? [0]));

  return (
    <aside className="flex w-64 shrink-0 flex-col border-l border-ink-700/70 bg-ink-900 shadow-rail">
      <div className="border-b border-ink-800 px-4 py-3">
        <h2 className="text-[12px] font-semibold uppercase tracking-wide text-ink-500">Usage</h2>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        <section>
          <p className="text-[11px] uppercase tracking-wide text-ink-600">Today</p>
          <p className="mt-1 font-mono text-2xl font-semibold text-ink-100/95">
            {formatCost(today?.costUsd ?? 0)}
            {today?.estimated && (
              <span className="ml-1 align-top text-xs text-ink-600" title="includes estimated pricing">
                ~
              </span>
            )}
          </p>
          <p className="mt-0.5 text-[11px] text-ink-500">{formatTokens(totalToday)} tokens</p>
        </section>

        <section className="mt-4 grid grid-cols-2 gap-2">
          <Stat label="In" value={formatTokens(today?.tokens.input ?? 0)} />
          <Stat label="Out" value={formatTokens(today?.tokens.output ?? 0)} />
          <Stat label="Cache w" value={formatTokens(today?.tokens.cacheWrite ?? 0)} />
          <Stat label="Cache r" value={formatTokens(today?.tokens.cacheRead ?? 0)} />
        </section>

        <section className="mt-5">
          <p className="mb-2 text-[11px] uppercase tracking-wide text-ink-600">By model</p>
          {usage && usage.byModel.length > 0 ? (
            <ul className="space-y-2">
              {usage.byModel.map((m) => (
                <li key={m.model}>
                  <div className="flex items-center justify-between text-[11.5px]">
                    <span className="truncate text-ink-100/80">
                      {modelLabel(m.model)}
                      {m.estimated && <span className="ml-1 text-ink-600">~</span>}
                    </span>
                    <span className="font-mono text-ink-500">{formatCost(m.costUsd)}</span>
                  </div>
                  <div className="mt-1 h-1 overflow-hidden rounded-full bg-ink-800">
                    <div
                      className="h-full rounded-full bg-accent/70"
                      style={{ width: `${Math.min(100, (m.costUsd / maxModelCost) * 100)}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[11.5px] text-ink-600">No spend recorded today.</p>
          )}
        </section>

        <p className="mt-6 text-[10px] leading-relaxed text-ink-700">
          Cost is derived from token counts × an editable pricing table. Charts, 5h &
          weekly windows, and burn-rate arrive in M2.
        </p>
      </div>
    </aside>
  );
}

function Stat({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="rounded-md border border-ink-800 bg-ink-850 px-2.5 py-1.5">
      <p className="text-[10px] uppercase tracking-wide text-ink-600">{label}</p>
      <p className="font-mono text-[13px] text-ink-100/85">{value}</p>
    </div>
  );
}
