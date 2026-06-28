import { EventEmitter } from 'node:events';
import { closeSync, openSync, readdirSync, readSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import chokidar, { type FSWatcher } from 'chokidar';

import {
  EMPTY_TOKENS,
  addTokens,
  type Agent,
  type AgentsSnapshot,
  type ModelUsage,
  type TokenCounts,
  type Usage
} from '@shared/types';
import { computeCost } from '@shared/pricing';

import { projectsDir, rosterPath, sessionsDir } from './paths';
import { isPidAlive, readRoster, type Roster } from './roster';
import { createAggregate, foldLine, type SessionAggregate } from './transcript';
import { deriveStatus } from './liveness';
import { UsageRoller } from './usage';

/** How many recent sessions (by mtime) to read for the M1 slice. */
const RECENT_SESSION_LIMIT = 40;
/** Debounce window before pushing a recomputed snapshot. */
const DEBOUNCE_MS = 300;
/** Poll fallback cadence (catches appends the watcher misses). */
const POLL_MS = 4000;

interface TailState {
  offset: number; // bytes consumed so far
  partial: string; // trailing incomplete line carried across reads
}

export interface EngineSnapshot {
  agents: AgentsSnapshot;
  usage: Usage;
}

/**
 * DataEngine — UI-agnostic heart. Reads ~/.claude READ-ONLY, folds transcripts
 * into a normalized {agents, usage} model and emits 'snapshot' on change.
 * Fail-soft everywhere: bad files/lines are skipped + logged, never fatal.
 */
export class DataEngine extends EventEmitter {
  private roster: Roster = { supervisorPid: 0, updatedAt: 0, workers: [] };
  private aggregates = new Map<string, SessionAggregate>(); // key: filePath
  private tails = new Map<string, TailState>(); // key: filePath
  /** M2: per-message usage over the last ~30d (own tails, fail-soft). */
  private roller = new UsageRoller();
  private watcher?: FSWatcher;
  private pollTimer?: NodeJS.Timeout;
  private debounceTimer?: NodeJS.Timeout;
  private started = false;

  async start(): Promise<EngineSnapshot> {
    if (this.started) return this.getSnapshot();
    this.started = true;

    this.loadRoster();
    this.scanAndIngest();
    const snap = this.getSnapshot();
    const u = this.roller.stats();
    console.error(
      `[engine] initial scan: ${this.roster.workers.length} roster worker(s), ` +
        `${this.aggregates.size} session(s) parsed; ` +
        `usage roller: ${u.records} record(s) across ${u.sessions} session(s) / ${u.files} file(s) over 30d.`
    );

    this.setupWatcher();
    this.pollTimer = setInterval(() => this.tick(), POLL_MS);
    if (this.pollTimer.unref) this.pollTimer.unref();

    return snap;
  }

  stop(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    void this.watcher?.close();
    this.started = false;
  }

  // ---- internals -----------------------------------------------------------

  private loadRoster(): void {
    try {
      this.roster = readRoster();
    } catch (err) {
      console.error('[engine] loadRoster failed (fail-soft):', (err as Error).message);
    }
  }

  /** List recent transcript files across all project dirs, plus active workers'. */
  private selectFiles(): string[] {
    const root = projectsDir();
    const found: Array<{ path: string; mtime: number }> = [];
    let projectDirs: string[] = [];
    try {
      projectDirs = readdirSync(root, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => join(root, d.name));
    } catch {
      return [];
    }
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
          found.push({ path: p, mtime: statSync(p).mtimeMs });
        } catch {
          /* ignore unreadable */
        }
      }
    }
    found.sort((a, b) => b.mtime - a.mtime);
    const selected = new Set(found.slice(0, RECENT_SESSION_LIMIT).map((f) => f.path));

    // Force-include transcripts for currently-active roster workers.
    const activeSessionIds = new Set(this.roster.workers.map((w) => w.sessionId).filter(Boolean));
    for (const f of found) {
      const sid = basename(f.path, '.jsonl');
      if (activeSessionIds.has(sid)) selected.add(f.path);
    }
    return [...selected];
  }

  /** Full discovery + incremental ingest pass. */
  private scanAndIngest(): void {
    for (const path of this.selectFiles()) {
      this.ingestFile(path);
    }
    // M2: widen usage collection to the last ~30 days (own file set + tails).
    try {
      this.roller.refresh();
    } catch (err) {
      console.error('[engine] usage roller refresh failed (fail-soft):', (err as Error).message);
    }
  }

  /** Incrementally tail one transcript file: parse only newly appended bytes. */
  private ingestFile(path: string): void {
    let size: number;
    try {
      size = statSync(path).size;
    } catch {
      return; // file vanished — keep last aggregate, fail-soft
    }
    let state = this.tails.get(path);
    if (!state) {
      state = { offset: 0, partial: '' };
      this.tails.set(path, state);
    }
    if (size < state.offset) {
      // Truncated/rotated → reset and re-read from scratch.
      state.offset = 0;
      state.partial = '';
      this.aggregates.delete(path);
    }
    if (size === state.offset) return; // nothing new

    const sessionId = basename(path, '.jsonl');
    let agg = this.aggregates.get(path);
    if (!agg) {
      agg = createAggregate(sessionId, path);
      agg.project = basename(basename(path, '.jsonl'));
      this.aggregates.set(path, agg);
    }

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
      console.error(`[engine] read failed for ${basename(path)} (fail-soft):`, (err as Error).message);
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
        foldLine(agg, JSON.parse(trimmed));
      } catch {
        // Skip + log a single bad JSONL line; never crash the stream.
        console.error(`[engine] skipped malformed line in ${basename(path)}`);
      }
    }
  }

  // ---- snapshot ------------------------------------------------------------

  getSnapshot(): EngineSnapshot {
    const now = Date.now();
    const workerBySession = new Map<string, number>(); // sessionId -> pid (alive)
    let activeWorkers = 0;
    for (const w of this.roster.workers) {
      if (w.sessionId && isPidAlive(w.pid)) {
        workerBySession.set(w.sessionId, w.pid);
        activeWorkers++;
      }
    }

    const agents: Agent[] = [];
    const usageByModel = new Map<string, TokenCounts>();

    for (const agg of this.aggregates.values()) {
      const pid = workerBySession.get(agg.sessionId);
      const status = deriveStatus({
        hasLiveWorker: pid !== undefined,
        lastActivityAt: agg.lastActivityAt,
        latestAssistantText: agg.latestAssistantText,
        hasErrorEvent: agg.hasErrorEvent,
        now
      });
      const { costUsd, estimated } = computeCost(agg.model, agg.tokens);

      agents.push({
        sessionId: agg.sessionId,
        pid,
        title: agg.title && agg.title.length ? agg.title : agg.project || agg.sessionId.slice(0, 8),
        status,
        model: agg.model || 'unknown',
        project: agg.project || 'unknown',
        cwd: agg.cwd,
        gitBranch: agg.gitBranch,
        startedAt: agg.startedAt,
        lastActivityAt: agg.lastActivityAt,
        tokens: agg.tokens,
        costUsd,
        estimated,
        activityLine: agg.activityLine
      });

      for (const [model, tokens] of agg.todayByModel) {
        usageByModel.set(model, addTokens(usageByModel.get(model) ?? { ...EMPTY_TOKENS }, tokens));
      }
    }

    // Newest activity first.
    agents.sort((a, b) => b.lastActivityAt - a.lastActivityAt);

    const byModel: ModelUsage[] = [];
    let todayTokens: TokenCounts = { ...EMPTY_TOKENS };
    let todayCost = 0;
    let anyEstimated = false;
    for (const [model, tokens] of usageByModel) {
      const { costUsd, estimated } = computeCost(model, tokens);
      byModel.push({ model, tokens, costUsd, estimated });
      todayTokens = addTokens(todayTokens, tokens);
      todayCost += costUsd;
      anyEstimated ||= estimated;
    }
    byModel.sort((a, b) => b.costUsd - a.costUsd);

    return {
      agents: {
        agents,
        activeWorkers,
        scannedSessions: this.aggregates.size,
        updatedAt: now
      },
      usage: {
        today: { costUsd: todayCost, tokens: todayTokens, estimated: anyEstimated },
        byModel,
        updatedAt: now,
        // M2 (additive): richer analytics over the ~30d window.
        analytics: this.computeUsageAnalytics(now)
      }
    };
  }

  /** Compute the M2 usage analytics, fail-soft (undefined on error). */
  private computeUsageAnalytics(now: number): EngineSnapshot['usage']['analytics'] {
    try {
      return this.roller.compute(now);
    } catch (err) {
      console.error('[engine] usage analytics failed (fail-soft):', (err as Error).message);
      return undefined;
    }
  }

  // ---- watch / poll --------------------------------------------------------

  private setupWatcher(): void {
    const watchPaths = [
      rosterPath(),
      join(sessionsDir(), '*.json'),
      join(projectsDir(), '**', '*.jsonl')
    ];
    try {
      this.watcher = chokidar.watch(watchPaths, {
        ignoreInitial: true,
        awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 },
        depth: 4
      });
      this.watcher
        .on('add', (p) => this.onFsEvent(p))
        .on('change', (p) => this.onFsEvent(p))
        .on('unlink', () => this.scheduleEmit())
        .on('error', (err) =>
          console.error('[engine] watcher error (fail-soft):', (err as Error).message)
        );
    } catch (err) {
      console.error('[engine] watcher setup failed (poll only):', (err as Error).message);
    }
  }

  private onFsEvent(path: string): void {
    if (path.endsWith('.jsonl')) {
      this.ingestFile(path);
      this.roller.ingestFile(path); // M2: also feed the usage roller
    } else if (path.endsWith('roster.json')) {
      this.loadRoster();
    }
    this.scheduleEmit();
  }

  /** Poll fallback: refresh roster, re-stat known files, discover new ones. */
  private tick(): void {
    this.loadRoster();
    for (const path of this.tails.keys()) this.ingestFile(path);
    this.scanAndIngest(); // pick up brand-new sessions
    this.scheduleEmit();
  }

  private scheduleEmit(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      try {
        this.emit('snapshot', this.getSnapshot());
      } catch (err) {
        console.error('[engine] emit failed (fail-soft):', (err as Error).message);
      }
    }, DEBOUNCE_MS);
  }
}
