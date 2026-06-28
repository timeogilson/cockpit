import { create } from 'zustand';
import { useControlStore } from './useControlStore';

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

/** One terminal we spawned and own here. */
export interface PtySession {
  id: string;
  title: string;
  cwd: string;
  project: string;
  model?: string;
  status: 'running' | 'exited';
  exitCode?: number;
  createdAt: number;
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

  /** Spawn a new `claude` PTY. Returns true on success. Fail-soft + toast. */
  newSession: (opts: {
    cwd: string;
    model?: string;
    prompt?: string;
    title?: string;
  }) => Promise<boolean>;

  /** Select a live PTY by id. */
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

export const useSessionStore = create<SessionState>((set, get) => ({
  runningHere: [],
  selected: null,

  newSession: async (opts) => {
    const api = window.cockpit;
    if (!api) {
      useControlStore.getState().pushToast('error', 'Bridge unavailable — cannot start session.');
      return false;
    }
    try {
      const res = await api.invoke('pty:create', {
        cwd: opts.cwd,
        shell: 'claude',
        cols: 80,
        rows: 24,
        model: opts.model,
        prompt: opts.prompt
      });
      if (res.ok && res.id) {
        const id = res.id;
        const title =
          opts.title?.trim() ||
          opts.prompt?.trim()?.slice(0, 60) ||
          basename(opts.cwd) ||
          'session';
        const session: PtySession = {
          id,
          title,
          cwd: opts.cwd,
          project: basename(opts.cwd),
          model: opts.model,
          status: 'running',
          createdAt: Date.now()
        };
        set((s) => ({
          runningHere: [...s.runningHere, session],
          selected: { kind: 'pty', id }
        }));
        return true;
      }
      useControlStore.getState().pushToast('error', res.error ?? 'Failed to start session.');
      return false;
    } catch (err) {
      useControlStore
        .getState()
        .pushToast('error', `Failed to start session: ${(err as Error).message}`);
      return false;
    }
  },

  selectPty: (id) => set({ selected: { kind: 'pty', id } }),
  selectObserved: (sessionId) => set({ selected: { kind: 'observed', sessionId } }),

  stopSession: (id) => {
    const api = window.cockpit;
    if (!api) return;
    try {
      void api.invoke('pty:kill', { id });
    } catch {
      /* fail-soft */
    }
  },

  removeSession: (id) => {
    const api = window.cockpit;
    const session = get().runningHere.find((s) => s.id === id);
    if (session?.status === 'running' && api) {
      try {
        void api.invoke('pty:kill', { id });
      } catch {
        /* fail-soft */
      }
    }
    clearPtyBuffers(id);
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
        runningHere: s.runningHere.map((x) =>
          x.id === e.id ? { ...x, status: 'exited', exitCode: e.code } : x
        )
      }));
    });
  }
}));
