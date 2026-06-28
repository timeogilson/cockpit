import type { AgentStatus, TokenCounts } from '@shared/types';

export function formatCost(usd: number): string {
  if (!Number.isFinite(usd)) return '$0.00';
  if (usd > 0 && usd < 0.01) return '<$0.01';
  if (usd < 100) return `$${usd.toFixed(2)}`;
  return `$${usd.toFixed(0)}`;
}

export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

export function sumTokens(t: TokenCounts): number {
  return t.input + t.output + t.cacheWrite + t.cacheRead;
}

/** Compact relative time, e.g. "3s", "12m", "2h", "5d". */
export function relativeTime(epochMs: number, now = Date.now()): string {
  if (!epochMs) return '—';
  const diff = Math.max(0, now - epochMs);
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

/** Elapsed duration between start and end, e.g. "4m", "1h 12m". */
export function elapsed(startMs: number, endMs: number): string {
  if (!startMs || !endMs || endMs < startMs) return '—';
  const totalMin = Math.floor((endMs - startMs) / 60000);
  if (totalMin < 1) return '<1m';
  if (totalMin < 60) return `${totalMin}m`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/** Trim long model ids to a friendly chip label. */
export function modelLabel(model: string): string {
  if (!model || model === 'unknown') return 'unknown';
  return model.replace(/^claude-/, '').replace(/-(\d{8})$/, '');
}

/** Fraction (0..1) → "42%". */
export function formatPct(frac: number): string {
  if (!Number.isFinite(frac)) return '0%';
  return `${Math.round(frac * 100)}%`;
}

/** Compact "$/hr" rate label. */
export function formatRate(usdPerHour: number): string {
  return `${formatCost(usdPerHour)}/hr`;
}

/** Short local date, e.g. "Jun 28". */
export function shortDate(epochMs: number): string {
  if (!epochMs) return '—';
  return new Date(epochMs).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Local hour label for a 0–23 hour, e.g. "14h". */
export function hourLabel(hour: number): string {
  return `${String(hour).padStart(2, '0')}h`;
}

export const STATUS_META: Record<
  AgentStatus,
  { label: string; dot: string; text: string; ring: string }
> = {
  busy: { label: 'Running', dot: 'bg-status-busy', text: 'text-status-busy', ring: 'ring-status-busy/30' },
  'needs-input': {
    label: 'Needs input',
    dot: 'bg-status-input',
    text: 'text-status-input',
    ring: 'ring-status-input/30'
  },
  done: { label: 'Done', dot: 'bg-status-done', text: 'text-status-done', ring: 'ring-status-done/30' },
  failed: { label: 'Failed', dot: 'bg-status-failed', text: 'text-status-failed', ring: 'ring-status-failed/30' },
  idle: { label: 'Idle', dot: 'bg-status-idle', text: 'text-status-idle', ring: 'ring-status-idle/30' }
};
