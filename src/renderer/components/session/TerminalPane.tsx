import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import '@xterm/xterm/css/xterm.css';
import type { PtySession } from '../../store/useSessionStore';
import { subscribeToPty, useSessionStore } from '../../store/useSessionStore';

/**
 * TerminalPane — one xterm.js terminal bound to a single in-app PTY row.
 *
 * Fidelity + reliability notes (so the embedded terminal behaves exactly like
 * running `claude` in a real terminal):
 *   - SIZE BEFORE SPAWN. The terminal is built and fit to its container FIRST;
 *     only then does it ask the store to `startPty()` at the measured cols/rows.
 *     The pty therefore spawns once at the visible size — no 80×24→resize churn,
 *     which is what garbled/duplicated Claude Code's first paint.
 *   - GPU + unicode + ConPTY. WebGL renderer (DOM fallback on context loss),
 *     Unicode 11 widths (box-drawing/emoji line up), and `windowsPty:conpty` to
 *     match node-pty's Windows backend.
 *   - LEGIBLE FAILURES. A create error or an immediate exit renders a failure
 *     pane (resolved path + exit code + Retry) instead of a silent blank screen.
 *
 * `session.id` is the stable row id (identity/selection); `session.ptyId` is the
 * live node-pty handle, assigned after spawn. All pty IPC keys on `ptyId`.
 */

const TERM_THEME = {
  background: '#0b0c0e',
  foreground: '#e9ecf1',
  cursor: '#d98a6f',
  selectionBackground: '#2a2f37',
  black: '#0b0c0e',
  red: '#f06a6a',
  green: '#4ec98a',
  yellow: '#f5b545',
  blue: '#5b9dff',
  magenta: '#c96442',
  cyan: '#5bb0c9',
  white: '#c7ccd5',
  brightBlack: '#5b6573',
  brightRed: '#f06a6a',
  brightGreen: '#4ec98a',
  brightYellow: '#f5b545',
  brightBlue: '#5b9dff',
  brightMagenta: '#d98a6f',
  brightCyan: '#7fd0e6',
  brightWhite: '#e9ecf1'
} as const;

const FONT_FAMILY = "'Cascadia Mono', 'Cascadia Code', Consolas, 'Courier New', monospace";

export default function TerminalPane({
  session,
  active
}: {
  session: PtySession;
  active: boolean;
}): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  /** Last measured geometry (drives size-before-spawn + retry). */
  const dimsRef = useRef<{ cols: number; rows: number } | null>(null);
  /** Last geometry actually forwarded to the pty (dedupe resize spam). */
  const lastSentRef = useRef<{ cols: number; rows: number } | null>(null);

  const id = session.id;
  const ptyId = session.ptyId;
  const status = session.status;

  const retrySession = useSessionStore((s) => s.retrySession);

  // ---- mount: build the terminal once, then spawn at the measured size ------
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const term = new Terminal({
      // WebGL + Unicode11 addons rely on proposed APIs.
      allowProposedApi: true,
      // Match node-pty's Windows backend so reflow/line-wrap heuristics agree.
      windowsPty: { backend: 'conpty' },
      fontFamily: FONT_FAMILY,
      fontSize: 13,
      cursorBlink: true,
      scrollback: 5000,
      theme: { ...TERM_THEME }
    });

    const fit = new FitAddon();
    term.loadAddon(fit);

    // Unicode 11 char widths (before open) so box-drawing/emoji match the TUI.
    try {
      const uni = new Unicode11Addon();
      term.loadAddon(uni);
      term.unicode.activeVersion = '11';
    } catch {
      /* fail-soft → default unicode widths */
    }

    term.open(container);

    // GPU renderer — loaded AFTER open. On context loss we dispose it; xterm then
    // falls back to its built-in DOM renderer automatically (no canvas addon, so
    // `npm install` stays clean against xterm 6 — see report).
    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => {
        try {
          webgl.dispose();
        } catch {
          /* fail-soft */
        }
      });
      term.loadAddon(webgl);
    } catch {
      /* fail-soft → DOM renderer */
    }

    termRef.current = term;
    fitRef.current = fit;

    // Input → pty. Resolve the live pty id at call-time (it's assigned after
    // spawn); keystrokes before the pty exists are simply dropped.
    const onDataDisp = term.onData((d: string) => {
      const pid = useSessionStore.getState().runningHere.find((r) => r.id === id)?.ptyId;
      if (!pid) return;
      try {
        void window.cockpit?.invoke('pty:write', { id: pid, data: d });
      } catch {
        /* fail-soft */
      }
    });

    // Measure → spawn at the REAL size. Retry on the next frame until the
    // container actually has layout (a hidden/0-size fit yields wrong dims).
    let raf = 0;
    const measureAndStart = (): void => {
      const el = containerRef.current;
      const t = termRef.current;
      if (!el || !t) return;
      if (el.clientWidth <= 0 || el.clientHeight <= 0) {
        raf = requestAnimationFrame(measureAndStart);
        return;
      }
      try {
        fit.fit();
        const dims = { cols: t.cols, rows: t.rows };
        dimsRef.current = dims;
        lastSentRef.current = dims;
        const st = useSessionStore.getState();
        const row = st.runningHere.find((r) => r.id === id);
        if (row && row.status === 'starting' && !row.ptyId) {
          void st.startPty(id, dims);
        }
      } catch {
        /* fail-soft — a transient zero-size layout shouldn't throw */
      }
    };
    measureAndStart();

    // Debounced resize: re-fit, and only forward when cols/rows actually change.
    let resizeTimer: ReturnType<typeof setTimeout> | undefined;
    const doFit = (): void => {
      const el = containerRef.current;
      const t = termRef.current;
      const f = fitRef.current;
      if (!el || !t || !f) return;
      if (el.clientWidth <= 0 || el.clientHeight <= 0) return;
      try {
        f.fit();
        const cols = t.cols;
        const rows = t.rows;
        dimsRef.current = { cols, rows };
        const last = lastSentRef.current;
        if (last && last.cols === cols && last.rows === rows) return;
        lastSentRef.current = { cols, rows };
        const pid = useSessionStore.getState().runningHere.find((r) => r.id === id)?.ptyId;
        if (pid) void window.cockpit?.invoke('pty:resize', { id: pid, cols, rows });
        t.refresh(0, t.rows - 1);
      } catch {
        /* fail-soft */
      }
    };
    const ro = new ResizeObserver(() => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(doFit, 120);
    });
    ro.observe(container);

    return () => {
      if (raf) cancelAnimationFrame(raf);
      if (resizeTimer) clearTimeout(resizeTimer);
      onDataDisp.dispose();
      ro.disconnect();
      try {
        term.dispose();
      } catch {
        /* fail-soft */
      }
      termRef.current = null;
      fitRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- bind output once the pty id is known (initial spawn or after retry) --
  useEffect(() => {
    if (!ptyId) return;
    const term = termRef.current;
    if (!term) return;
    const unsub = subscribeToPty(ptyId, (chunk) => term.write(chunk));
    return unsub;
  }, [ptyId]);

  // ---- retry: a row returning to 'starting' (already measured) re-spawns -----
  useEffect(() => {
    if (status !== 'starting' || ptyId) return;
    const dims = dimsRef.current;
    if (!dims) return; // initial spawn is kicked from the mount effect instead
    try {
      termRef.current?.reset();
    } catch {
      /* fail-soft */
    }
    lastSentRef.current = dims;
    void useSessionStore.getState().startPty(id, dims);
  }, [status, ptyId, id]);

  // ---- when this pane becomes active (visible): it now has layout → fit ------
  useEffect(() => {
    if (!active) return;
    const term = termRef.current;
    const fit = fitRef.current;
    const el = containerRef.current;
    if (!term || !fit || !el) return;
    if (el.clientWidth <= 0 || el.clientHeight <= 0) return;
    try {
      fit.fit();
      const cols = term.cols;
      const rows = term.rows;
      dimsRef.current = { cols, rows };
      const last = lastSentRef.current;
      if (!last || last.cols !== cols || last.rows !== rows) {
        lastSentRef.current = { cols, rows };
        if (ptyId) void window.cockpit?.invoke('pty:resize', { id: ptyId, cols, rows });
      }
      term.focus();
    } catch {
      /* fail-soft */
    }
  }, [active, ptyId]);

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden rounded-lg border border-ink-700/70 bg-ink-950 p-3">
      {session.status === 'exited' && (
        <div className="mb-1.5 shrink-0 text-[11px] text-ink-500">
          session exited (code {session.exitCode ?? '?'})
        </div>
      )}
      <div className="relative h-full min-h-0 w-full">
        <div ref={containerRef} className="h-full min-h-0 w-full" />

        {session.status === 'starting' && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <span className="text-[12px] text-ink-500">Launching claude…</span>
          </div>
        )}

        {session.status === 'failed' && (
          <div className="absolute inset-0 grid place-items-center bg-ink-950/95 p-6">
            <div className="max-w-md text-center">
              <p className="text-[13px] font-medium text-status-failed">claude failed to launch</p>
              {session.error && (
                <p className="mt-1.5 text-[12px] leading-relaxed text-ink-400">{session.error}</p>
              )}
              <dl className="mt-3 space-y-1 rounded-md border border-ink-800 bg-ink-900/60 px-3 py-2 text-left text-[11px]">
                <div className="flex gap-2">
                  <dt className="shrink-0 text-ink-600">path</dt>
                  <dd className="min-w-0 break-all font-mono text-ink-300">
                    {session.resolvedPath ?? 'claude not found on PATH'}
                  </dd>
                </div>
                {typeof session.exitCode === 'number' && (
                  <div className="flex gap-2">
                    <dt className="shrink-0 text-ink-600">exit code</dt>
                    <dd className="font-mono text-ink-300">{session.exitCode}</dd>
                  </div>
                )}
              </dl>
              <button
                onClick={() => retrySession(session.id)}
                className="mt-4 rounded-md bg-accent px-3.5 py-1.5 text-[12.5px] font-medium text-white transition-colors hover:bg-accent-soft"
              >
                Retry
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
