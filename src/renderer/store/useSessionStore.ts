import { create } from 'zustand';

/**
 * Session-shell store — the in-app ("running here") PTY sessions plus the
 * current selection (a live PTY or an observed/external transcript).
 *
 * Kept fully independent of the read-only engine store (`useStore`): it must
 * NOT import it, so `useStore.init()` can safely call `initSessions()` without
 * an import cycle.
 *
 * PTY OUTPUT is intentionally NOT held in reactive zustand state — streaming
 * every chunk through `set()` would cause a re-render storm. Instead each pty's
 * output accumulates in a module-level ring buffer (`buffers`) and is delivered
 * to xterm via `subscribeToPty()`. Only lifecycle facts (status/exit) live in
 * the store.
 */

/**
 * Lifecycle of an in-app terminal row:
 *   starting → running → exited       (normal)
 *   starting → failed                 (pty:create error)
 *   running  → failed                 (pty exited ≤1.5s after spawn = launch fail)
 */
export type PtyStatus = 'starting' | 'running' | 'exited' | 'failed';

/**
 * One terminal we spawned and own here.
 *
 * `id` is a STABLE client-side row id — it is the React key, the selection key,
 * and what every store action takes. The node-pty handle (`ptyId`) is assigned
 * LATER, once `TerminalPane` has measured its size and `startPty` has spawned the
 * pty at those real dimensions (this is what kills the 80×24→resize garble). All
 * pty IPC (write/resize/kill/subscribe) keys on `ptyId`, never on `id`.
 */
export interface PtySession {
  /** Stable client row id (React key + selection + store actions). */
  id: string;
  /** node-pty id, assigned once the pty is actually spawned. */
  ptyId?: string;
  title: string;
  cwd: string;
  project: string;
  model?: string;
  /** Kept so a failed launch can be retried with the same seed prompt. */
  prompt?: string;
  status: PtyStatus;
  exitCode?: number;
  /** Human-readable failure reason (create error or immediate-exit). */
  error?: string;
  /** Absolute claude/shell path main resolved — shown in the failure pane. */
  resolvedPath?: string;
  createdAt: number;
  /** epoch ms the pty actually spawned (used to detect immediate-exit failures). */
  spawnedAt?: number;
}

/** What the center pane is currently showing. */
export type SessionSelection =
  | { kind: 'pty'; id: string }
  | { kind: 'observed'; sessionId: string }
  | null;

interface SessionState {
  /** Live PTY sessions started inside Cockpit. */
  runningHere: PtySession[];
  /** Current center-pane selection. */
  selected: SessionSelection;

  /**
   * Add a new `claude` session ROW (status `'starting'`, no pty yet) and select
   * it. The pty is spawned later by `startPty`, once `TerminalPane` has measured
   * its real size. Returns the stable row id.
   */
  newSession: (opts: {
    cwd: string;
    model?: string;
    prompt?: string;
    title?: string;
  }) => string;

  /**
   * Spawn the pty for a `'starting'` row at the terminal's MEASURED dimensions.
   * Records the returned pty id (status → `'running'`) or marks the row failed.
   * Idempotent + fail-soft: a redundant call for an already-started row is a
   * no-op.
   */
  startPty: (rowId: string, dims: { cols: number; rows: number }) => Promise<void>;

  /** Reset a failed/exited row to `'starting'` so its pane re-spawns the pty. */
  retrySession: (rowId: string) => void;

  /** Select a live PTY by row id. */
  selectPty: (id: string) => void;
  /** Select an observed/external session by sessionId. */
  selectObserved: (sessionId: string) => void;

  /** Kill a session's process (keeps the row + buffer). Fail-soft. */
  stopSession: (id: string) => void;
  /** Kill (if running), drop buffers/listeners, and remove the row. */
  removeSession: (id: string) => void;

  /** Idempotently wire the global pty:data / pty:exit subscriptions. */
  initSessions: () => void;
}

// ---------------------------------------------------------------------------
// Module-level output buffering (NOT reactive zustand state).
// ---------------------------------------------------------------------------

/** Per-pty output cap — keep the most-recent ~256 KiB so replay is bounded. */
const CAP = 256 * 1024;
const buffers = new Map<string, string>();
const listeners = new Map<string, Set<(chunk: string) => void>>();

function appendBuffer(id: string, chunk: string): void {
  const cur = (buffers.get(id) ?? '') + chunk;
  buffers.set(id, cur.length > CAP ? cur.slice(cur.length - CAP) : cur);
  const ls = listeners.get(id);
  if (ls) {
    for (const fn of ls) {
      try {
        fn(chunk);
      } catch {
        /* a bad listener must never break the stream */
      }
    }
  }
}

/**
 * Subscribe an xterm instance to one pty's output. Synchronously replays the
 * buffered-so-far output (if any) via `onChunk`, THEN registers `onChunk` as a
 * live listener. Because this runs synchronously with no `await`, no incoming
 * `pty:data` callback can interleave between replay and registration — so there
 * is no lost/duplicated output. Returns an unsubscribe.
 */
export function subscribeToPty(id: string, onChunk: (chunk: string) => void): () => void {
  const existing = buffers.get(id);
  if (existing) onChunk(existing);

  let set = listeners.get(id);
  if (!set) {
    set = new Set();
    listeners.set(id, set);
  }
  set.add(onChunk);

  return () => {
    const s = listeners.get(id);
    if (!s) return;
    s.delete(onChunk);
    if (s.size === 0) listeners.delete(id);
  };
}

/** Drop all buffered output + listeners for a pty (used when removing it). */
export function clearPtyBuffers(id: string): void {
  buffers.delete(id);
  listeners.delete(id);
}

/** Last path segment, splitting on both `/` and `\`. */
function basename(p: string): string {
  const parts = p.split(/[/\\]+/).filter((s) => s.length > 0);
  return parts.length > 0 ? parts[parts.length - 1] : '';
}

// ---------------------------------------------------------------------------
// Global subscriptions — wired once for the app lifetime (idempotent).
// ---------------------------------------------------------------------------

let wired = false;

/** Monotonic client-side row-id source (independent of node-pty ids). */
let rowSeq = 0;
/** Rows with a `pty:create` in flight — guards against a double-spawn. */
const startInFlight = new Set<string>();
/** A pty that exits within this window of spawn is treated as a launch failure. */
const IMMEDIATE_EXIT_MS = 1500;

export const useSessionStore = create<SessionState>((set, get) => ({
  runningHere: [],
  selected: null,

  newSession: (opts) => {
    const id = `sess-${++rowSeq}`;
    const title =
      opts.title?.trim() || opts.prompt?.trim()?.slice(0, 60) || basename(opts.cwd) || 'session';
    const session: PtySession = {
      id,
      title,
      cwd: opts.cwd,
      project: basename(opts.cwd),
      model: opts.model,
      prompt: opts.prompt,
      status: 'starting',
      createdAt: Date.now()
    };
    set((s) => ({
      runningHere: [...s.runningHere, session],
      selected: { kind: 'pty', id }
    }));
    return id;
  },

  startPty: async (rowId, dims) => {
    if (startInFlight.has(rowId)) return;
    const row = get().runningHere.find((r) => r.id === rowId);
    // Only spawn for a fresh 'starting' row with no pty yet.
    if (!row || row.ptyId || row.status !== 'starting') return;

    const api = window.cockpit;
    if (!api) {
      set((s) => ({
        runningHere: s.runningHere.map((x) =>
          x.id === rowId ? { ...x, status: 'failed', error: 'Bridge unavailable.' } : x
        )
      }));
      return;
    }

    const cols = Number.isFinite(dims.cols) && dims.cols > 0 ? Math.floor(dims.cols) : 80;
    const rows = Number.isFinite(dims.rows) && dims.rows > 0 ? Math.floor(dims.rows) : 24;

    startInFlight.add(rowId);
    try {
      const res = await api.invoke('pty:create', {
        cwd: row.cwd,
        shell: 'claude',
        cols,
        rows,
        model: row.model,
        prompt: row.prompt
      });
      set((s) => ({
        runningHere: s.runningHere.map((x) => {
          if (x.id !== rowId) return x;
          if (res.ok && res.id) {
            return {
              ...x,
              ptyId: res.id,
              status: 'running',
              resolvedPath: res.resolvedPath,
              spawnedAt: Date.now(),
              error: undefined,
              exitCode: undefined
            };
          }
          return {
            ...x,
            status: 'failed',
            error: res.error ?? 'Failed to start session.',
            resolvedPath: res.resolvedPath
          };
        })
      }));
    } catch (err) {
      const error = (err as Error).message;
      set((s) => ({
        runningHere: s.runningHere.map((x) =>
          x.id === rowId ? { ...x, status: 'failed', error } : x
        )
      }));
    } finally {
      startInFlight.delete(rowId);
    }
  },

  retrySession: (rowId) => {
    const api = window.cockpit;
    const row = get().runningHere.find((r) => r.id === rowId);
    if (!row) return;
    // Tear down any prior pty + its buffer so the retry starts clean.
    if (row.ptyId) {
      try {
        void api?.invoke('pty:kill', { id: row.ptyId });
      } catch {
        /* fail-soft */
      }
      clearPtyBuffers(row.ptyId);
    }
    set((s) => ({
      runningHere: s.runningHere.map((x) =>
        x.id === rowId
          ? {
              ...x,
              ptyId: undefined,
              status: 'starting',
              error: undefined,
              exitCode: undefined,
              spawnedAt: undefined
            }
          : x
      )
    }));
  },

  selectPty: (id) => set({ selected: { kind: 'pty', id } }),
  selectObserved: (sessionId) => set({ selected: { kind: 'observed', sessionId } }),

  stopSession: (id) => {
    const api = window.cockpit;
    const row = get().runningHere.find((s) => s.id === id);
    if (!api || !row?.ptyId) return;
    try {
      void api.invoke('pty:kill', { id: row.ptyId });
    } catch {
      /* fail-soft */
    }
  },

  removeSession: (id) => {
    const api = window.cockpit;
    const session = get().runningHere.find((s) => s.id === id);
    if (session?.status === 'running' && session.ptyId && api) {
      try {
        void api.invoke('pty:kill', { id: session.ptyId });
      } catch {
        /* fail-soft */
      }
    }
    if (session?.ptyId) clearPtyBuffers(session.ptyId);
    set((s) => {
      const selected =
        s.selected?.kind === 'pty' && s.selected.id === id ? null : s.selected;
      return { runningHere: s.runningHere.filter((x) => x.id !== id), selected };
    });
  },

  initSessions: () => {
    if (wired) return;
    const api = window.cockpit;
    if (!api) return;
    wired = true;
    api.subscribe('pty:data', (e) => appendBuffer(e.id, e.chunk));
    api.subscribe('pty:exit', (e) => {
      set((s) => ({
        runningHere: s.runningHere.map((x) => {
          if (x.ptyId !== e.id) return x;
          // A pty that dies almost immediately after spawn = claude failed to
          // launch → surface a 'failed' pane (path + code + Retry), not a blank
          // "exited" terminal.
          const immediate =
            typeof x.spawnedAt === 'number' && Date.now() - x.spawnedAt < IMMEDIATE_EXIT_MS;
          return {
            ...x,
            status: immediate ? 'failed' : 'exited',
            exitCode: e.code,
            error: immediate ? `claude exited immediately (code ${e.code}).` : x.error
          };
        })
      }));
    });
  }
}));
