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
