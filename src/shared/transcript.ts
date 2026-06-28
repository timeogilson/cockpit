// Transcript-detail wire types — the on-demand payload behind the detail drawer.
//
// Separate from the live `Agent` model (types.ts): the agents board streams a
// lightweight summary, while opening a card fetches THIS richer, ordered view of
// one session's transcript. Kept UI-agnostic and additive so a future Codex
// adapter can produce the same shape.

import type { TokenCounts } from './types';

/** Normalized event kinds rendered in the viewer. */
export type TranscriptEventKind = 'user' | 'assistant' | 'system' | 'tool';

/** One tool_use block, condensed for display (full input is never shipped). */
export interface ToolUseSummary {
  /** Tool name, e.g. "Edit", "Bash", "Task". */
  name: string;
  /** Short, human-readable summary of the tool input (already truncated). */
  inputSummary: string;
  /** Resolved file path when the tool touches a file (Edit/Write/Read/…). */
  filePath?: string;
}

/** A single normalized transcript event (one JSONL line, condensed). */
export interface TranscriptEvent {
  kind: TranscriptEventKind;
  /** epoch ms; 0 when the line carried no parseable timestamp. */
  timestamp: number;
  uuid?: string;
  parentUuid?: string;
  isSidechain: boolean;
  /** Plain text body (user / system / tool-result). */
  text?: string;
  /** Assistant prose, rendered as Markdown by the viewer. */
  markdown?: string;
  /** tool_use blocks emitted by an assistant turn. */
  toolUses?: ToolUseSummary[];
  /** Per-assistant token usage, when present. */
  usage?: TokenCounts;
  /** Model id for an assistant turn. */
  model?: string;
}

/** A file the session created or modified, derived from Edit/Write/MultiEdit/NotebookEdit. */
export interface FileTouched {
  /** Full path as seen in the tool input. */
  path: string;
  /** Basename for display. */
  name: string;
  /** Dominant operation: 'edit' | 'write' | 'multiedit' | 'notebook'. */
  op: string;
  /** Number of touching tool calls. */
  count: number;
}

/** Cost split by token bucket (USD), so the drawer can show a breakdown. */
export interface CostBreakdown {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}

/** A subagent (sidechain) session linked to its parent via directory layout. */
export interface SubagentNode {
  /** agentId (filename stem) or session-derived id. */
  id: string;
  /** First user prompt, truncated. */
  title: string;
  model: string;
  tokens: TokenCounts;
  costUsd: number;
  estimated: boolean;
  startedAt: number;
  lastActivityAt: number;
  eventCount: number;
  /** Absolute path of the subagent transcript (for debugging / future open). */
  filePath: string;
  /** Nested subagents, when a subagent spawned its own (usually empty). */
  children: SubagentNode[];
}

/** Full on-demand detail for one session. Always fail-soft; never throws to the UI. */
export interface TranscriptDetail {
  sessionId: string;
  title: string;
  model: string;
  project: string;
  cwd: string;
  gitBranch?: string;
  startedAt: number;
  lastActivityAt: number;
  tokens: TokenCounts;
  costUsd: number;
  costBreakdown: CostBreakdown;
  /** True when fallback (unknown-model) pricing was used. */
  estimated: boolean;
  /** Ordered, renderable events (capped — see `truncated`). */
  events: TranscriptEvent[];
  filesTouched: FileTouched[];
  subagents: SubagentNode[];
  /** True when the event list was capped for size. */
  truncated: boolean;
  /** Total events parsed before any cap. */
  totalEvents: number;
  /** epoch ms when this detail was computed. */
  fetchedAt: number;
  /** True when no transcript file could be located for the sessionId. */
  notFound: boolean;
}
