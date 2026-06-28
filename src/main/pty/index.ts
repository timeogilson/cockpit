import { EventEmitter } from 'node:events';
import * as pty from 'node-pty';
import type { IPty } from 'node-pty';

import type { PtyCreateRequest, PtyDataEvent, PtyExitEvent } from '@shared/pty';

/**
 * PtyManager — the session-shell keystone. Owns every live pseudo-terminal in
 * the main process (node-pty), streaming output back to the renderer over IPC.
 *
 * node-pty ships ABI-stable N-API prebuilds (loaded directly from
 * `node-pty/prebuilds/<platform>-<arch>/`), so the same binary runs under both
 * Node and this Electron without a from-source rebuild. On Windows the backend
 * is ConPTY.
 *
 * Design rules (mirrors Controller):
 *  - One singleton via `getPtyManager()`.
 *  - Fail-soft EVERYWHERE: unknown ids and spawn errors are logged and swallowed,
 *    never thrown across the IPC boundary.
 *  - Emits typed `'data'` / `'exit'` events; `ipc.ts` forwards them to the window.
 *  - Never touches ~/.claude.
 */

/** Strongly-typed event surface so listeners don't fall back to `any`. */
export interface PtyManagerEvents {
  data: (e: PtyDataEvent) => void;
  exit: (e: PtyExitEvent) => void;
}

interface TrackedPty {
  id: string;
  pty: IPty;
}

/** Platform default shell when the caller doesn't specify one. */
function defaultShell(): string {
  if (process.platform === 'win32') {
    return process.env.ComSpec || 'powershell.exe';
  }
  return process.env.SHELL || '/bin/bash';
}

export class PtyManager extends EventEmitter {
  private ptys = new Map<string, TrackedPty>();
  private seq = 0;

  // ---- typed event overrides (keep listeners type-safe) -------------------
  override on<E extends keyof PtyManagerEvents>(event: E, listener: PtyManagerEvents[E]): this {
    return super.on(event, listener);
  }
  override emit<E extends keyof PtyManagerEvents>(
    event: E,
    ...args: Parameters<PtyManagerEvents[E]>
  ): boolean {
    return super.emit(event, ...args);
  }

  /**
   * Spawn a new pseudo-terminal. Returns the generated id.
   * Throws only if node-pty itself fails — callers (IPC) wrap this fail-soft.
   */
  create(opts: PtyCreateRequest): string {
    const shell = opts.shell?.trim() || defaultShell();
    const args = opts.args ?? [];
    const cols = Number.isFinite(opts.cols) && opts.cols > 0 ? Math.floor(opts.cols) : 80;
    const rows = Number.isFinite(opts.rows) && opts.rows > 0 ? Math.floor(opts.rows) : 24;
    const id = `pty-${++this.seq}`;

    // node-pty env wants Record<string, string | undefined>; process.env already
    // matches, and the caller's overrides merge on top.
    const env: Record<string, string | undefined> = { ...process.env, ...opts.env };

    const term = pty.spawn(shell, args, {
      name: 'xterm-color',
      cols,
      rows,
      cwd: opts.cwd,
      env
    });

    const tracked: TrackedPty = { id, pty: term };
    this.ptys.set(id, tracked);

    term.onData((chunk: string) => {
      this.emit('data', { id, chunk });
    });

    term.onExit(({ exitCode }: { exitCode: number; signal?: number }) => {
      this.ptys.delete(id);
      this.emit('exit', { id, code: exitCode });
    });

    console.error(`[pty] created ${id} (shell=${shell} cwd=${opts.cwd} ${cols}x${rows} pid=${term.pid})`);
    return id;
  }

  /** Write data to a pty. No-op (logged) if the id is unknown. */
  write(id: string, data: string): void {
    const tracked = this.ptys.get(id);
    if (!tracked) {
      console.error(`[pty] write to unknown id ${id} (ignored)`);
      return;
    }
    try {
      tracked.pty.write(data);
    } catch (err) {
      console.error(`[pty] write failed for ${id}:`, (err as Error).message);
    }
  }

  /** Resize a pty's viewport. No-op (logged) if the id is unknown. */
  resize(id: string, cols: number, rows: number): void {
    const tracked = this.ptys.get(id);
    if (!tracked) {
      console.error(`[pty] resize of unknown id ${id} (ignored)`);
      return;
    }
    const c = Number.isFinite(cols) && cols > 0 ? Math.floor(cols) : 80;
    const r = Number.isFinite(rows) && rows > 0 ? Math.floor(rows) : 24;
    try {
      tracked.pty.resize(c, r);
    } catch (err) {
      console.error(`[pty] resize failed for ${id}:`, (err as Error).message);
    }
  }

  /** Kill a pty. No-op (logged) if the id is unknown. */
  kill(id: string): void {
    const tracked = this.ptys.get(id);
    if (!tracked) {
      console.error(`[pty] kill of unknown id ${id} (ignored)`);
      return;
    }
    try {
      tracked.pty.kill();
    } catch (err) {
      console.error(`[pty] kill failed for ${id}:`, (err as Error).message);
    }
    // onExit removes it from the map; drop eagerly too in case kill races.
    this.ptys.delete(id);
  }

  /** Ids of all currently tracked ptys. */
  list(): string[] {
    return [...this.ptys.keys()];
  }

  /** Best-effort kill of every tracked pty (called on app quit). */
  killAll(): void {
    for (const id of [...this.ptys.keys()]) {
      this.kill(id);
    }
  }
}

let singleton: PtyManager | null = null;

export function getPtyManager(): PtyManager {
  if (!singleton) singleton = new PtyManager();
  return singleton;
}
