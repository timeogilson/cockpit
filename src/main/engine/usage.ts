import { closeSync, openSync, readdirSync, readSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

import {
  EMPTY_TOKENS,
  addTokens,
  type ExpensiveSession,
  type TokenCounts,
  type UsageAnalytics,
  type UsageBreakdown,
  type UsageCache,
  type UsageCostPoint,
  type UsageHeatCell,
  type UsageWindow
} from '@shared/types';
import { computeCost, getModelRate } from '@shared/pricing';

import { projectsDir } from './paths';

// --- Tunables ---------------------------------------------------------------

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
/** How far back usage analytics reach. */
const WINDOW_DAYS = 30;
const WINDOW_MS = WINDOW_DAYS * DAY_MS;
/** 5-hour rolling window. */
const FIVE_H_MS = 5 * HOUR_MS;
/** Weekly window. */
const WEEK_MS = 7 * DAY_MS;
/** Cap the number of transcript files scanned (by mtime) to bound CPU. */
const MAX_USAGE_FILES = 500;
/** Skip pathologically large files (fail-soft) to avoid blocking on a giant read. */
const MAX_FILE_BYTES = 64 * 1024 * 1024;
/** Hard ceiling on retained records (drop oldest beyond this). */
const MAX_RECORDS = 250_000;
/** Top-N most-expensive sessions. */
const LEADERBOARD_N = 8;

/** One priced assistant message (the unit of usage analytics). */
export interface UsageRecord {
  timestamp: number;
  model: string;
  project: string;
  sessionId: string;
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
  costUsd: number;
  estimated: boolean;
}

interface TailState {
  offset: number;
  partial: string;
}

interface SessionMeta {
  title?: string;
  project: string;
  model: string;
}

/** Read optional USD cap from env (per-window). Returns undefined if unset/invalid. */
function capFromEnv(name: string): number | undefined {
  const raw = process.env[name];
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function startOfLocalDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Minimal text extraction (string or text-block array) — self-contained. */
function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const block of content) {
      if (block && typeof block === 'object' && (block as { type?: string }).type === 'text') {
        const t = (block as { text?: unknown }).text;
        if (typeof t === 'string') parts.push(t);
      }
    }
    return parts.join(' ');
  }
  return '';
}

function isHumanText(content: unknown): boolean {
  if (typeof content === 'string') return content.trim().length > 0;
  if (Array.isArray(content)) {
    const hasToolResult = content.some(
      (b) => b && typeof b === 'object' && (b as { type?: string }).type === 'tool_result'
    );
    if (hasToolResult) return false;
    return extractText(content).trim().length > 0;
  }
  return false;
}

function truncate(s: string, n: number): string {
  const clean = s.replace(/\s+/g, ' ').trim();
  return clean.length > n ? clean.slice(0, n - 1).trimEnd() + '…' : clean;
}

/**
 * UsageRoller — independent, fail-soft collector of per-message usage records
 * across the last ~30 days of transcripts. Maintains its own byte-offset tails
 * (decoupled from the agents board's 40-session view) and computes the rich
 * Usage analytics on demand. All `~/.claude` access is READ-ONLY.
 */
export class UsageRoller {
  private tails = new Map<string, TailState>(); // key: filePath
  private records: UsageRecord[] = [];
  private meta = new Map<string, SessionMeta>(); // key: sessionId
  /** Per-session-file start/end timestamps (for the leaderboard). */
  private fileSpan = new Map<string, { startedAt: number; lastActivityAt: number }>();

  /** Discover recent transcript files and tail any new bytes. Fail-soft. */
  refresh(now = Date.now()): void {
    const cutoff = now - WINDOW_MS;
    for (const path of this.selectFiles(cutoff)) {
      this.ingestFile(path);
    }
    this.prune(now);
  }

  /** Tail a single file by path (used by the watcher fast-path). Fail-soft. */
  ingestFile(path: string): void {
    if (!path.endsWith('.jsonl')) return;
    let size: number;
    try {
      size = statSync(path).size;
    } catch {
      return; // vanished — keep prior records
    }
    if (size > MAX_FILE_BYTES) return; // skip giant files (fail-soft)

    let state = this.tails.get(path);
    if (!state) {
      state = { offset: 0, partial: '' };
      this.tails.set(path, state);
    }
    const sessionId = basename(path, '.jsonl');
    if (size < state.offset) {
      // Truncated/rotated (rare; transcripts are append-only) → drop this
      // session's prior records and re-read from scratch to avoid double-counting.
      state.offset = 0;
      state.partial = '';
      this.records = this.records.filter((r) => r.sessionId !== sessionId);
      this.fileSpan.delete(sessionId);
    }
    if (size === state.offset) return; // nothing new
    let buf: Buffer;
    try {
      const len = size - state.offset;
      buf = Buffer.alloc(len);
      const fd = openSync(path, 'r');
      try {
        readSync(fd, buf, 0, len, state.offset);
      } finally {
        closeSync(fd);
      }
    } catch (err) {
      console.error(
        `[usage] read failed for ${basename(path)} (fail-soft):`,
        (err as Error).message
      );
      return;
    }
    state.offset = size;

    const text = state.partial + buf.toString('utf8');
    const parts = text.split('\n');
    state.partial = parts.pop() ?? '';

    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      try {
        this.foldLine(sessionId, JSON.parse(trimmed));
      } catch {
        // Skip a single bad JSONL line; never crash the stream.
      }
    }
  }

  /** List transcript files modified within the window, capped by mtime. */
  private selectFiles(cutoff: number): string[] {
    const root = projectsDir();
    let projectDirs: string[] = [];
    try {
      projectDirs = readdirSync(root, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => join(root, d.name));
    } catch {
      return [];
    }
    const found: Array<{ path: string; mtime: number }> = [];
    for (const dir of projectDirs) {
      let entries: string[] = [];
      try {
        entries = readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
      } catch {
        continue;
      }
      for (const f of entries) {
        const p = join(dir, f);
        try {
          const mtime = statSync(p).mtimeMs;
          // Keep already-tracked files even if older (so we keep their tail);
          // otherwise require activity within the window.
          if (mtime >= cutoff || this.tails.has(p)) found.push({ path: p, mtime });
        } catch {
          /* ignore unreadable */
        }
      }
    }
    found.sort((a, b) => b.mtime - a.mtime);
    return found.slice(0, MAX_USAGE_FILES).map((f) => f.path);
  }

  /** Fold one parsed JSONL object into records/meta. Defensive throughout. */
  private foldLine(sessionId: string, raw: unknown): void {
    if (!raw || typeof raw !== 'object') return;
    const line = raw as {
      type?: string;
      timestamp?: string;
      cwd?: string;
      message?: {
        role?: string;
        model?: string;
        content?: unknown;
        usage?: {
          input_tokens?: number;
          output_tokens?: number;
          cache_creation_input_tokens?: number;
          cache_read_input_tokens?: number;
        };
      };
    };

    const ts = line.timestamp ? Date.parse(line.timestamp) : NaN;
    const project = typeof line.cwd === 'string' && line.cwd ? basename(line.cwd) : undefined;

    let m = this.meta.get(sessionId);
    if (!m) {
      m = { project: project ?? 'unknown', model: 'unknown' };
      this.meta.set(sessionId, m);
    }
    if (project) m.project = project;

    const msg = line.message;
    if (!msg) return;

    // Capture a human title (first real user turn) for the leaderboard.
    if (line.type === 'user' && !m.title && isHumanText(msg.content)) {
      m.title = truncate(extractText(msg.content), 80);
      return;
    }

    if (line.type !== 'assistant') return;
    if (typeof msg.model === 'string' && msg.model) m.model = msg.model;
    const u = msg.usage;
    if (!u) return;

    const input = u.input_tokens ?? 0;
    const output = u.output_tokens ?? 0;
    const cacheWrite = u.cache_creation_input_tokens ?? 0;
    const cacheRead = u.cache_read_input_tokens ?? 0;
    if (input + output + cacheWrite + cacheRead === 0) return;
    if (Number.isNaN(ts)) return; // need a timestamp to place in a window

    const tokens: TokenCounts = { input, output, cacheWrite, cacheRead };
    const { costUsd, estimated } = computeCost(m.model, tokens);

    this.records.push({
      timestamp: ts,
      model: m.model,
      project: m.project,
      sessionId,
      input,
      output,
      cacheWrite,
      cacheRead,
      costUsd,
      estimated
    });

    const span = this.fileSpan.get(sessionId);
    if (!span) {
      this.fileSpan.set(sessionId, { startedAt: ts, lastActivityAt: ts });
    } else {
      if (ts < span.startedAt) span.startedAt = ts;
      if (ts > span.lastActivityAt) span.lastActivityAt = ts;
    }
  }

  /** Drop records outside the retention window and enforce the hard cap. */
  private prune(now: number): void {
    const cutoff = now - WINDOW_MS;
    if (this.records.length > MAX_RECORDS || this.records.some((r) => r.timestamp < cutoff)) {
      this.records = this.records.filter((r) => r.timestamp >= cutoff);
      if (this.records.length > MAX_RECORDS) {
        this.records.sort((a, b) => a.timestamp - b.timestamp);
        this.records = this.records.slice(this.records.length - MAX_RECORDS);
      }
    }
  }

  /** Diagnostics for stderr logging. */
  stats(): { records: number; sessions: number; files: number } {
    return { records: this.records.length, sessions: this.meta.size, files: this.tails.size };
  }

  // --- compute --------------------------------------------------------------

  compute(now = Date.now()): UsageAnalytics {
    const startToday = startOfLocalDay(now);
    const cutoff5h = now - FIVE_H_MS;
    const cutoffWeek = now - WEEK_MS;
    const cutoffHour = now - HOUR_MS;

    const today = newWindow(0);
    const window5h = newWindow(FIVE_H_MS);
    const week = newWindow(WEEK_MS);

    const byModel = new Map<string, MutBreakdown>();
    const byProject = new Map<string, MutBreakdown>();

    let cacheReadTokens = 0;
    let freshInputTokens = 0;
    let savedUsd = 0;
    let burnHourCost = 0;

    // Hourly buckets for today (key = hour 0..23).
    const hourBuckets = new Map<number, { costUsd: number; tokens: number }>();
    // Daily buckets across the window (key = local day start ms).
    const dayBuckets = new Map<number, { costUsd: number; tokens: number }>();
    // Heatmap (key = dow*24 + hour).
    const heat = new Map<number, { count: number; costUsd: number }>();
    // Session totals for the leaderboard.
    const sessionTotals = new Map<string, MutSession>();

    const rateCache = new Map<string, { input: number; cacheRead: number }>();
    let sessionCount = 0;

    for (const r of this.records) {
      const tk: TokenCounts = {
        input: r.input,
        output: r.output,
        cacheWrite: r.cacheWrite,
        cacheRead: r.cacheRead
      };

      if (r.timestamp >= startToday) accWindow(today, r, tk);
      if (r.timestamp >= cutoff5h) accWindow(window5h, r, tk);
      if (r.timestamp >= cutoffWeek) accWindow(week, r, tk);
      if (r.timestamp >= cutoffHour) burnHourCost += r.costUsd;

      // Per-model / per-project breakdowns (full window).
      accBreakdown(byModel, r.model, r, tk);
      accBreakdown(byProject, r.project, r, tk);

      // Cache efficiency + savings.
      cacheReadTokens += r.cacheRead;
      freshInputTokens += r.input;
      if (r.cacheRead > 0) {
        let rc = rateCache.get(r.model);
        if (!rc) {
          const { rate } = getModelRate(r.model);
          rc = { input: rate.input, cacheRead: rate.cacheRead };
          rateCache.set(r.model, rc);
        }
        savedUsd += (r.cacheRead * (rc.input - rc.cacheRead)) / 1_000_000;
      }

      // Cost-over-time.
      if (r.timestamp >= startToday) {
        const h = new Date(r.timestamp).getHours();
        const hb = hourBuckets.get(h) ?? { costUsd: 0, tokens: 0 };
        hb.costUsd += r.costUsd;
        hb.tokens += totalOf(tk);
        hourBuckets.set(h, hb);
      }
      const dayKey = startOfLocalDay(r.timestamp);
      const db = dayBuckets.get(dayKey) ?? { costUsd: 0, tokens: 0 };
      db.costUsd += r.costUsd;
      db.tokens += totalOf(tk);
      dayBuckets.set(dayKey, db);

      // Heatmap.
      const d = new Date(r.timestamp);
      const hk = d.getDay() * 24 + d.getHours();
      const hc = heat.get(hk) ?? { count: 0, costUsd: 0 };
      hc.count += 1;
      hc.costUsd += r.costUsd;
      heat.set(hk, hc);

      // Session leaderboard.
      let st = sessionTotals.get(r.sessionId);
      if (!st) {
        sessionCount += 1;
        st = {
          tokens: { ...EMPTY_TOKENS },
          costUsd: 0,
          estimated: false,
          messages: 0,
          model: r.model
        };
        sessionTotals.set(r.sessionId, st);
      }
      st.tokens = addTokens(st.tokens, tk);
      st.costUsd += r.costUsd;
      st.estimated ||= r.estimated;
      st.messages += 1;
      st.model = r.model;
    }

    // Caps (optional, env-driven).
    applyCap(window5h, capFromEnv('COCKPIT_5H_CAP_USD'));
    applyCap(week, capFromEnv('COCKPIT_WEEKLY_CAP_USD'));

    // Cost-over-time series.
    const costToday: UsageCostPoint[] = [];
    const nowHour = new Date(now).getHours();
    for (let h = 0; h <= nowHour; h++) {
      const hb = hourBuckets.get(h) ?? { costUsd: 0, tokens: 0 };
      costToday.push({ t: startToday + h * HOUR_MS, costUsd: hb.costUsd, tokens: hb.tokens });
    }
    const costSeries: UsageCostPoint[] = [];
    const firstDay = startOfLocalDay(now - WINDOW_MS);
    const lastDay = startOfLocalDay(now);
    for (let d = firstDay; d <= lastDay; d += DAY_MS) {
      const db = dayBuckets.get(d) ?? { costUsd: 0, tokens: 0 };
      costSeries.push({ t: d, costUsd: db.costUsd, tokens: db.tokens });
    }

    // Heatmap → flat list (only non-empty cells; UI fills the grid).
    const heatmap: UsageHeatCell[] = [];
    for (const [k, v] of heat) {
      heatmap.push({ dow: Math.floor(k / 24), hour: k % 24, count: v.count, costUsd: v.costUsd });
    }

    // Burn rate + projections.
    const burnRatePerHour = burnHourCost; // cost over the trailing hour
    const hoursElapsedToday = Math.max(0.25, (now - startToday) / HOUR_MS);
    const projectedDay = (today.costUsd / hoursElapsedToday) * 24;
    // Trailing daily average across days that actually have activity in the window.
    const activeDays = Math.max(1, dayBuckets.size);
    let windowCost = 0;
    for (const v of dayBuckets.values()) windowCost += v.costUsd;
    const projectedMonth = (windowCost / activeDays) * 30;

    // Leaderboard.
    const expensiveSessions: ExpensiveSession[] = [...sessionTotals.entries()]
      .sort((a, b) => b[1].costUsd - a[1].costUsd)
      .slice(0, LEADERBOARD_N)
      .map(([sessionId, st]) => {
        const m = this.meta.get(sessionId);
        const span = this.fileSpan.get(sessionId);
        return {
          sessionId,
          title: m?.title || m?.project || sessionId.slice(0, 8),
          project: m?.project || 'unknown',
          model: st.model || m?.model || 'unknown',
          costUsd: st.costUsd,
          tokens: st.tokens,
          estimated: st.estimated,
          startedAt: span?.startedAt ?? 0,
          lastActivityAt: span?.lastActivityAt ?? 0,
          messages: st.messages
        };
      });

    const cache: UsageCache = {
      cacheReadTokens,
      freshInputTokens,
      efficiency:
        cacheReadTokens + freshInputTokens > 0
          ? cacheReadTokens / (cacheReadTokens + freshInputTokens)
          : 0,
      savedUsd
    };

    return {
      today,
      window5h,
      week,
      byModel: finishBreakdown(byModel),
      byProject: finishBreakdown(byProject),
      burnRatePerHour,
      projectedDay,
      projectedMonth,
      cache,
      costToday,
      costSeries,
      heatmap,
      expensiveSessions,
      windowDays: WINDOW_DAYS,
      recordCount: this.records.length,
      sessionCount
    };
  }
}

// --- compute helpers --------------------------------------------------------

interface MutBreakdown {
  tokens: TokenCounts;
  costUsd: number;
  estimated: boolean;
  messages: number;
}

interface MutSession {
  tokens: TokenCounts;
  costUsd: number;
  estimated: boolean;
  messages: number;
  model: string;
}

function totalOf(t: TokenCounts): number {
  return t.input + t.output + t.cacheWrite + t.cacheRead;
}

function newWindow(windowMs: number): UsageWindow {
  return {
    costUsd: 0,
    tokens: { ...EMPTY_TOKENS },
    estimated: false,
    messages: 0,
    windowMs
  };
}

function accWindow(w: UsageWindow, r: UsageRecord, tk: TokenCounts): void {
  w.costUsd += r.costUsd;
  w.tokens = addTokens(w.tokens, tk);
  w.estimated ||= r.estimated;
  w.messages += 1;
}

function applyCap(w: UsageWindow, capUsd: number | undefined): void {
  if (capUsd && capUsd > 0) {
    w.capUsd = capUsd;
    w.pctOfCap = w.costUsd / capUsd;
  }
}

function accBreakdown(
  map: Map<string, MutBreakdown>,
  key: string,
  r: UsageRecord,
  tk: TokenCounts
): void {
  const k = key || 'unknown';
  let b = map.get(k);
  if (!b) {
    b = { tokens: { ...EMPTY_TOKENS }, costUsd: 0, estimated: false, messages: 0 };
    map.set(k, b);
  }
  b.tokens = addTokens(b.tokens, tk);
  b.costUsd += r.costUsd;
  b.estimated ||= r.estimated;
  b.messages += 1;
}

function finishBreakdown(map: Map<string, MutBreakdown>): UsageBreakdown[] {
  return [...map.entries()]
    .map(([key, b]) => ({
      key,
      tokens: b.tokens,
      costUsd: b.costUsd,
      estimated: b.estimated,
      messages: b.messages
    }))
    .sort((a, b) => b.costUsd - a.costUsd);
}
