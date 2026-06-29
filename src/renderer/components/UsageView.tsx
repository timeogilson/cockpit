import type { ReactNode } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import type { ExpensiveSession, UsageHeatCell, UsageWindow } from '@shared/types';
import { useStore } from '../store/useStore';
import {
  formatCost,
  formatPct,
  formatRate,
  formatTokens,
  hourLabel,
  modelLabel,
  shortDate,
  sumTokens
} from '../lib/format';

// Theme-matched chart colors (Recharts can't read Tailwind tokens).
// Warm-dark palette: clay accent + status-busy + muted warm neutrals, no neon.
const C = {
  grid: '#382f27', // ink-700 — grid/axis lines (low opacity via opacity props)
  axis: '#8a7d70', // ink-500 — tick text
  area: '#d97757', // accent (clay) — primary series
  busy: '#6a9fc4', // status-busy (calm blue) — secondary series
  done: '#6f9e72' // status-done (muted green)
};
// Donut/bar multi-hue: accent first, then desaturated warm neutrals + muted status hues.
const DONUT = ['#d97757', '#a99c8d', '#8a7d70', '#6a9fc4', '#6f9e72', '#c4b8a8', '#c15f3c', '#5c5046'];

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function UsageView(): JSX.Element {
  const usage = useStore((s) => s.usage);
  const a = usage?.analytics;

  if (!usage) {
    return (
      <div className="grid h-full place-items-center text-sm text-ink-500">
        Connecting to the engine…
      </div>
    );
  }
  if (!a || a.recordCount === 0) {
    return (
      <div className="grid h-full place-items-center text-center">
        <div>
          <h2 className="text-sm font-medium text-ink-100/80">No usage recorded yet</h2>
          <p className="mt-1 max-w-xs text-xs text-ink-500">
            Cockpit scans the last 30 days of transcripts. Spend will appear here as Claude Code
            sessions run.
          </p>
        </div>
      </div>
    );
  }

  const modelData = a.byModel
    .filter((m) => m.costUsd > 0)
    .map((m, i) => ({ name: modelLabel(m.key), value: m.costUsd, fill: DONUT[i % DONUT.length], raw: m }));
  const projectData = a.byProject.filter((p) => p.costUsd > 0).slice(0, 8);

  return (
    <div className="h-full overflow-y-auto pr-1">
      <div className="mb-4 flex items-baseline gap-3">
        <h1 className="text-[15px] font-semibold text-ink-100/90">Usage</h1>
        <span className="text-xs text-ink-500">
          last {a.windowDays}d · {a.recordCount.toLocaleString()} messages · {a.sessionCount} sessions
        </span>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <Kpi label="Today" value={formatCost(a.today.costUsd)} sub={`${a.today.messages} msgs`} />
        <Kpi label="This week" value={formatCost(a.week.costUsd)} sub={pctCap(a.week)} />
        <Kpi label="5h window" value={formatCost(a.window5h.costUsd)} sub={pctCap(a.window5h)} />
        <Kpi label="Burn rate" value={formatRate(a.burnRatePerHour)} sub="last hour" accent />
        <Kpi label="Proj. day" value={formatCost(a.projectedDay)} sub="at today's pace" />
        <Kpi label="Proj. month" value={formatCost(a.projectedMonth)} sub="trailing avg" accent />
      </div>

      {/* Cost over time (daily) */}
      <Panel title="Cost over time" subtitle={`${a.windowDays} days`}>
        <div className="h-56 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={a.costSeries} margin={{ top: 8, right: 12, bottom: 0, left: 4 }}>
              <defs>
                <linearGradient id="costFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={C.area} stopOpacity={0.45} />
                  <stop offset="100%" stopColor={C.area} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="t"
                tickFormatter={(t: number) => shortDate(t)}
                stroke={C.axis}
                tick={{ fontSize: 10, fill: C.axis }}
                minTickGap={28}
                tickLine={false}
                axisLine={{ stroke: C.grid }}
              />
              <YAxis
                tickFormatter={(v: number) => formatCost(v)}
                stroke={C.axis}
                tick={{ fontSize: 10, fill: C.axis }}
                width={48}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                content={renderTooltip((p) => `${shortDate(Number(p.t))} · ${formatCost(Number(p.costUsd))}`)}
                cursor={{ stroke: C.grid }}
              />
              <Area
                type="monotone"
                dataKey="costUsd"
                stroke={C.area}
                strokeWidth={1.5}
                fill="url(#costFill)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Panel>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {/* Per-model donut */}
        <Panel title="By model" subtitle="cost share">
          <div className="flex items-center gap-3">
            <div className="relative h-44 w-44 shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={modelData}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={48}
                    outerRadius={72}
                    paddingAngle={2}
                    stroke="none"
                  >
                    {modelData.map((d) => (
                      <Cell key={d.name} fill={d.fill} />
                    ))}
                  </Pie>
                  <Tooltip
                    content={renderTooltip((p) => `${String(p.name)} · ${formatCost(Number(p.value))}`)}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 grid place-items-center">
                <div className="text-center">
                  <p className="font-mono text-sm font-semibold tabular-nums text-ink-100/90">
                    {formatCost(modelData.reduce((s, d) => s + d.value, 0))}
                  </p>
                  <p className="text-[9px] uppercase tracking-[0.08em] text-ink-500">{a.windowDays}d</p>
                </div>
              </div>
            </div>
            <ul className="min-w-0 flex-1 space-y-1.5">
              {modelData.slice(0, 6).map((d) => (
                <li key={d.name} className="flex items-center gap-2 text-[12px]">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: d.fill }} />
                  <span className="min-w-0 flex-1 truncate text-ink-100/80">
                    {d.name}
                    {d.raw.estimated && <span className="ml-1 text-ink-500" title="estimated pricing">~</span>}
                  </span>
                  <span className="font-mono tabular-nums text-ink-500">{formatCost(d.value)}</span>
                </li>
              ))}
            </ul>
          </div>
        </Panel>

        {/* Per-project bars */}
        <Panel title="By project" subtitle="top spenders">
          <div className="h-44 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={projectData}
                layout="vertical"
                margin={{ top: 0, right: 12, bottom: 0, left: 4 }}
              >
                <XAxis type="number" hide />
                <YAxis
                  type="category"
                  dataKey="key"
                  width={104}
                  tick={{ fontSize: 11, fill: C.axis }}
                  tickFormatter={(s: string) => truncateLabel(s, 14)}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  cursor={{ fill: '#ffffff08' }}
                  content={renderTooltip((p) => `${String(p.key)} · ${formatCost(Number(p.costUsd))}`)}
                />
                <Bar dataKey="costUsd" radius={[0, 3, 3, 0]} barSize={14}>
                  {projectData.map((p, i) => (
                    <Cell key={p.key} fill={DONUT[i % DONUT.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        {/* Today hourly */}
        <Panel title="Today by hour" subtitle="hourly spend">
          <div className="h-40 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={a.costToday} margin={{ top: 8, right: 8, bottom: 0, left: 4 }}>
                <defs>
                  <linearGradient id="todayFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={C.busy} stopOpacity={0.45} />
                    <stop offset="100%" stopColor={C.busy} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="t"
                  tickFormatter={(t: number) => hourLabel(new Date(t).getHours())}
                  stroke={C.axis}
                  tick={{ fontSize: 9, fill: C.axis }}
                  minTickGap={20}
                  tickLine={false}
                  axisLine={{ stroke: C.grid }}
                />
                <YAxis hide />
                <Tooltip
                  content={renderTooltip(
                    (p) => `${hourLabel(new Date(Number(p.t)).getHours())} · ${formatCost(Number(p.costUsd))}`
                  )}
                  cursor={{ stroke: C.grid }}
                />
                <Area
                  type="monotone"
                  dataKey="costUsd"
                  stroke={C.busy}
                  strokeWidth={1.5}
                  fill="url(#todayFill)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        {/* Cache efficiency */}
        <Panel title="Cache efficiency" subtitle="reads vs fresh input">
          <div className="flex h-40 flex-col justify-center">
            <p className="font-mono text-3xl font-semibold text-status-done">
              {formatPct(a.cache.efficiency)}
            </p>
            <p className="mt-1 text-xs text-ink-500">
              of input tokens served from cache
            </p>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-ink-800">
              <div
                className="h-full rounded-full bg-status-done"
                style={{ width: `${Math.min(100, a.cache.efficiency * 100)}%` }}
              />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
              <MiniStat label="Cache reads" value={formatTokens(a.cache.cacheReadTokens)} />
              <MiniStat label="Fresh input" value={formatTokens(a.cache.freshInputTokens)} />
              <MiniStat label="Saved" value={formatCost(a.cache.savedUsd)} accent />
              <MiniStat
                label="Window"
                value={`${formatCost(a.week.costUsd)} / 7d`}
              />
            </div>
          </div>
        </Panel>

        {/* Projections */}
        <Panel title="Projections" subtitle="run-rate estimates">
          <div className="flex h-40 flex-col justify-center gap-3">
            <BigStat label="Burn rate" value={formatRate(a.burnRatePerHour)} hint="trailing hour" />
            <BigStat label="Projected day" value={formatCost(a.projectedDay)} hint="today's pace" />
            <BigStat label="Projected month" value={formatCost(a.projectedMonth)} hint="trailing daily avg" />
          </div>
        </Panel>
      </div>

      {/* Heatmap */}
      <Panel title="Activity heatmap" subtitle="messages by hour × weekday">
        <Heatmap cells={a.heatmap} />
      </Panel>

      {/* Leaderboard */}
      <Panel title="Most expensive sessions" subtitle={`top ${a.expensiveSessions.length}`}>
        <Leaderboard rows={a.expensiveSessions} />
      </Panel>

      <p className="px-1 py-3 text-[10px] text-ink-500">
        Spend is derived from token counts × an editable pricing table; unknown models are flagged
        with ~ and estimated. Set COCKPIT_5H_CAP_USD / COCKPIT_WEEKLY_CAP_USD to track caps.
      </p>
    </div>
  );
}

// --- tooltip ---------------------------------------------------------------

/** Build a Recharts tooltip renderer from a point→label fn. */
function renderTooltip(label: (point: Record<string, unknown>) => string) {
  // Recharts' ContentType signature is intentionally loose; accept `any` and
  // narrow internally.
  return function TooltipContent(props: {
    active?: boolean;
    payload?: ReadonlyArray<{ payload?: unknown }>;
  }): JSX.Element | null {
    if (!props.active || !props.payload || props.payload.length === 0) return null;
    const point = (props.payload[0]?.payload ?? {}) as Record<string, unknown>;
    return (
      <div className="rounded-md border border-ink-700 bg-ink-850 px-2.5 py-1.5 font-mono text-[11px] tabular-nums text-ink-100 shadow-pop">
        {label(point)}
      </div>
    );
  };
}

// --- small presentational pieces -------------------------------------------

function Panel({
  title,
  subtitle,
  children
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <section className="mt-3 rounded-lg border border-ink-700/60 bg-ink-900/60 p-3.5">
      <header className="mb-3 flex items-baseline justify-between">
        <h2 className="text-[13px] font-semibold text-ink-100/85">{title}</h2>
        {subtitle && <span className="text-[10.5px] uppercase tracking-[0.08em] text-ink-500">{subtitle}</span>}
      </header>
      {children}
    </section>
  );
}

function Kpi({
  label,
  value,
  sub,
  accent
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
}): JSX.Element {
  return (
    <div className="rounded-lg border border-ink-700/60 bg-ink-850 px-3 py-2.5">
      <p className="text-[10px] uppercase tracking-[0.08em] text-ink-500">{label}</p>
      <p className={`mt-0.5 font-mono text-lg font-semibold tabular-nums ${accent ? 'text-accent' : 'text-ink-100/95'}`}>
        {value}
      </p>
      {sub && <p className="text-[10px] text-ink-500">{sub}</p>}
    </div>
  );
}

function MiniStat({ label, value, accent }: { label: string; value: string; accent?: boolean }): JSX.Element {
  return (
    <div className="rounded-md border border-ink-800 bg-ink-850 px-2 py-1">
      <p className="text-[9px] uppercase tracking-[0.08em] text-ink-500">{label}</p>
      <p className={`font-mono text-[12px] tabular-nums ${accent ? 'text-accent' : 'text-ink-100/80'}`}>{value}</p>
    </div>
  );
}

function BigStat({ label, value, hint }: { label: string; value: string; hint: string }): JSX.Element {
  return (
    <div className="flex items-baseline justify-between border-b border-ink-800 pb-2 last:border-0">
      <div>
        <p className="text-[11px] text-ink-100/75">{label}</p>
        <p className="text-[10px] text-ink-500">{hint}</p>
      </div>
      <p className="font-mono text-base font-semibold tabular-nums text-ink-100/90">{value}</p>
    </div>
  );
}

function Heatmap({ cells }: { cells: UsageHeatCell[] }): JSX.Element {
  // Build a 7×24 count matrix.
  const grid: number[][] = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  let max = 0;
  for (const c of cells) {
    if (c.dow < 0 || c.dow > 6 || c.hour < 0 || c.hour > 23) continue;
    grid[c.dow][c.hour] = c.count;
    if (c.count > max) max = c.count;
  }
  const color = (n: number): string => {
    if (n <= 0 || max <= 0) return '#221d18'; // ink-850 — empty cell
    const t = 0.1 + 0.9 * (n / max);
    return `rgba(217,119,87,${t.toFixed(3)})`; // accent clay intensity ramp
  };
  return (
    <div className="overflow-x-auto">
      <div className="inline-flex min-w-full flex-col gap-1">
        {/* hour header */}
        <div className="flex items-center gap-1 pl-9 text-[8.5px] text-ink-500">
          {Array.from({ length: 24 }, (_, h) => (
            <div key={h} className="w-3.5 text-center">
              {h % 6 === 0 ? h : ''}
            </div>
          ))}
        </div>
        {grid.map((row, dow) => (
          <div key={dow} className="flex items-center gap-1">
            <div className="w-8 text-right text-[9px] text-ink-500">{DOW[dow]}</div>
            {row.map((n, hour) => (
              <div
                key={hour}
                className="h-3.5 w-3.5 rounded-[2px]"
                style={{ background: color(n) }}
                title={`${DOW[dow]} ${hourLabel(hour)} · ${n} msg`}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function Leaderboard({ rows }: { rows: ExpensiveSession[] }): JSX.Element {
  if (rows.length === 0) {
    return <p className="text-[12px] text-ink-500">No sessions recorded in the window.</p>;
  }
  const max = Math.max(0.0001, ...rows.map((r) => r.costUsd));
  return (
    <ul className="space-y-1.5">
      {rows.map((r) => (
        <li
          key={r.sessionId}
          className="relative overflow-hidden rounded-md border border-ink-800 bg-ink-850 px-3 py-2"
        >
          <div
            className="absolute inset-y-0 left-0 bg-accent/10"
            style={{ width: `${(r.costUsd / max) * 100}%` }}
          />
          <div className="relative flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12.5px] text-ink-100/90">{r.title}</p>
              <p className="truncate text-[10.5px] text-ink-500">
                {r.project} · {modelLabel(r.model)}
                {r.estimated && <span className="ml-1 text-ink-500" title="estimated pricing">~</span>} · {r.messages} msgs
              </p>
            </div>
            <div className="shrink-0 text-right">
              <p className="font-mono text-[13px] tabular-nums text-ink-100/90">{formatCost(r.costUsd)}</p>
              <p className="font-mono text-[10px] tabular-nums text-ink-500">{formatTokens(sumTokens(r.tokens))}</p>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

// --- helpers ---------------------------------------------------------------

function pctCap(win: UsageWindow): string {
  if (win.pctOfCap !== undefined) return `${formatPct(win.pctOfCap)} of cap`;
  return `${win.messages} msgs`;
}

function truncateLabel(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
