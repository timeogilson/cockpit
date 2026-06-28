// Cockpit domain model — shared by main, preload, and renderer.
// Keep this UI-agnostic: it is the normalized shape the Data Engine produces
// and the renderer consumes. A future Codex adapter feeds the same model.

export type AgentStatus = 'busy' | 'idle' | 'needs-input' | 'done' | 'failed';

export interface TokenCounts {
  input: number;
  output: number;
  cacheWrite: number; // cache_creation_input_tokens
  cacheRead: number; // cache_read_input_tokens
}

export interface Agent {
  /** Stable session id (transcript filename == sessionId). */
  sessionId: string;
  /** OS pid when the session has a live roster worker. */
  pid?: number;
  /** Human title — first user message text, truncated; falls back to project. */
  title: string;
  status: AgentStatus;
  /** Last assistant model seen, e.g. "claude-opus-4-8". */
  model: string;
  /** Basename of cwd. */
  project: string;
  cwd: string;
  gitBranch?: string;
  /** epoch ms */
  startedAt: number;
  /** epoch ms */
  lastActivityAt: number;
  tokens: TokenCounts;
  costUsd: number;
  /** True when cost used a fallback (unknown model) pricing row. */
  estimated: boolean;
  /** Live activity line — last tool_use name or last assistant snippet. */
  activityLine?: string;
  /** Convenience: number of subagent (sidechain) sessions linked. M5 fills the tree. */
  subagentCount?: number;
}

export interface ModelUsage {
  model: string;
  tokens: TokenCounts;
  costUsd: number;
  estimated: boolean;
}

export interface Usage {
  today: {
    costUsd: number;
    tokens: TokenCounts;
    estimated: boolean;
  };
  byModel: ModelUsage[];
  /** epoch ms when this snapshot was computed. */
  updatedAt: number;
  /**
   * M2 (additive, optional): richer usage analytics produced by the UsageRoller
   * over the last ~30 days of transcripts. Absent on older snapshots — consumers
   * must treat it as optional and fall back to `today` / `byModel`.
   */
  analytics?: UsageAnalytics;
}

export interface AgentsSnapshot {
  agents: Agent[];
  /** Count of live roster workers backing these agents. */
  activeWorkers: number;
  /** Number of recent transcript sessions scanned. */
  scannedSessions: number;
  /** epoch ms */
  updatedAt: number;
}

export interface AppInfo {
  app: string;
  electron: string;
  node: string;
  chrome: string;
  claudeDir: string;
}

export const EMPTY_TOKENS: TokenCounts = {
  input: 0,
  output: 0,
  cacheWrite: 0,
  cacheRead: 0
};

export function addTokens(a: TokenCounts, b: TokenCounts): TokenCounts {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    cacheRead: a.cacheRead + b.cacheRead
  };
}

export function totalTokens(t: TokenCounts): number {
  return t.input + t.output + t.cacheWrite + t.cacheRead;
}

// ---------------------------------------------------------------------------
// M2 — Usage analytics (additive). All shapes below are appended for the
// `Usage.analytics` field. Nothing above this line is modified or reordered.
// ---------------------------------------------------------------------------

/** A spend window (today / 5h rolling / weekly) with an optional cap %. */
export interface UsageWindow {
  costUsd: number;
  tokens: TokenCounts;
  estimated: boolean;
  /** Number of priced messages contributing to this window. */
  messages: number;
  /** Window length in ms (informational; 0 for "today"). */
  windowMs: number;
  /** Optional configured spend cap for this window, USD. */
  capUsd?: number;
  /** costUsd / capUsd (0..1+) when a cap is configured. */
  pctOfCap?: number;
}

/** One row of a per-model or per-project breakdown. */
export interface UsageBreakdown {
  /** Model id (byModel) or project basename (byProject). */
  key: string;
  tokens: TokenCounts;
  costUsd: number;
  estimated: boolean;
  messages: number;
}

/** A single point in a cost-over-time series (hourly or daily bucket). */
export interface UsageCostPoint {
  /** epoch ms — bucket start (local hour or local day). */
  t: number;
  costUsd: number;
  tokens: number;
}

/** One cell of the activity heatmap (hour-of-day × day-of-week, local). */
export interface UsageHeatCell {
  /** 0 = Sunday … 6 = Saturday (local). */
  dow: number;
  /** 0–23 local hour. */
  hour: number;
  count: number;
  costUsd: number;
}

/** Cache efficiency summary. */
export interface UsageCache {
  cacheReadTokens: number;
  /** Fresh (non-cached) input tokens. */
  freshInputTokens: number;
  /** cacheRead / (cacheRead + freshInput) in 0..1. */
  efficiency: number;
  /** USD saved by cache reads vs paying the fresh-input rate. */
  savedUsd: number;
}

/** A row in the most-expensive-sessions leaderboard. */
export interface ExpensiveSession {
  sessionId: string;
  title: string;
  project: string;
  model: string;
  costUsd: number;
  tokens: TokenCounts;
  estimated: boolean;
  startedAt: number;
  lastActivityAt: number;
  messages: number;
}

/** Rich usage analytics computed by the UsageRoller over the ~30d window. */
export interface UsageAnalytics {
  /** Roller-computed "today" (covers the full scan, not just recent sessions). */
  today: UsageWindow;
  /** 5-hour rolling window. */
  window5h: UsageWindow;
  /** 7-day rolling window. */
  week: UsageWindow;
  byModel: UsageBreakdown[];
  byProject: UsageBreakdown[];
  /** $/hour over the most recent hour. */
  burnRatePerHour: number;
  /** Today's spend extrapolated to a full day at the current pace. */
  projectedDay: number;
  /** Trailing daily average extrapolated to a ~30-day month. */
  projectedMonth: number;
  cache: UsageCache;
  /** Hourly cost buckets for today (local). */
  costToday: UsageCostPoint[];
  /** Daily cost buckets across the window (local). */
  costSeries: UsageCostPoint[];
  /** Up to 7×24 activity heatmap cells (local). */
  heatmap: UsageHeatCell[];
  /** Top-N most expensive sessions in the window. */
  expensiveSessions: ExpensiveSession[];
  /** Window length in days (≈30). */
  windowDays: number;
  /** Diagnostics: priced message records retained. */
  recordCount: number;
  /** Diagnostics: distinct sessions seen in the window. */
  sessionCount: number;
}
