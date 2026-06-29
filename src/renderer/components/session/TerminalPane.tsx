import { useCallback, useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { ChevronDown, Square, SquareTerminal } from 'lucide-react';
import '@xterm/xterm/css/xterm.css';
import type { PtySession, PtyStatus } from '../../store/useSessionStore';
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
 * SMART AUTO-SCROLL. Claude Code is an Ink (React-for-terminals) app that draws
 * INLINE — no alt-screen, no mouse tracking (verified by probe) — so xterm holds
 * real scrollback. This pane therefore implements a "follow / break-follow"
 * model just like a chat log:
 *   - While pinned to the bottom (`follow`), new output keeps the view at the
 *     bottom — you watch claude go live.
 *   - The instant you scroll up to read, we STOP yanking you down, count the new
 *     lines that arrive, and float a "Jump to latest" pill bottom-right.
 *   - Clicking the pill (or scrolling back to the bottom) re-pins to the bottom.
 * Wheel/keyboard scrollback works natively (no mouse mode steals the wheel); we
 * only tune sensitivity + smooth-scroll for feel. Follow state is per terminal
 * instance, so switching sessions never clobbers another pane's scroll position.
 *
 * `session.id` is the stable row id (identity/selection); `session.ptyId` is the
 * live node-pty handle, assigned after spawn. All pty IPC keys on `ptyId`.
 */

const TERM_THEME = {
  background: '#14110d',
  foreground: '#ece4d8',
  cursor: '#d97757',
  cursorAccent: '#14110d',
  selectionBackground: '#3a3128',
  black: '#221d18',
  red: '#d2674d',
  green: '#6f9e72',
  yellow: '#e0a23f',
  blue: '#6a9fc4',
  magenta: '#d97757',
  cyan: '#7fb0b8',
  white: '#d9cfc1',
  brightBlack: '#8a7d70',
  brightRed: '#e07a60',
  brightGreen: '#7faf82',
  brightYellow: '#ecb45a',
  brightBlue: '#84b3d4',
  brightMagenta: '#e08a6d',
  brightCyan: '#9fcad2',
  brightWhite: '#f7f1e7'
} as const;

const FONT_FAMILY = "'JetBrains Mono', 'Cascadia Mono', 'Cascadia Code', Consolas, monospace";

/** Slim header chip (model id) — matches the sidebar chip. */
const HEADER_CHIP =
  'shrink-0 rounded border border-ink-700 bg-ink-850 px-1.5 font-mono text-[10px] text-ink-200';

/** Live PTY status → terminal-frame header dot color + label + pulse. */
const HEADER_STATUS: Record<PtyStatus, { label: string; dot: string; text: string; pulse: boolean }> =
  {
    starting: { label: 'starting', dot: 'bg-status-busy', text: 'text-status-busy', pulse: false },
    running: { label: 'running', dot: 'bg-status-busy', text: 'text-status-busy', pulse: true },
    exited: { label: 'exited', dot: 'bg-status-idle', text: 'text-status-idle', pulse: false },
    failed: { label: 'failed', dot: 'bg-status-failed', text: 'text-status-failed', pulse: false }
  };

/**
 * "At bottom" tolerance, in lines. The viewport counts as pinned to the bottom
 * when it's within this many rows of the latest line, so a 1-line jitter from a
 * redraw doesn't spuriously break follow.
 */
const BOTTOM_THRESHOLD = 1;

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

  // ---- smart auto-scroll state (per terminal instance) ---------------------
  /** True while the viewport is pinned to the bottom (we keep following output). */
  const followRef = useRef(true);
  /** Scrollback baseY captured the moment the user broke follow (scrolled up). */
  const baseAtLeaveRef = useRef(0);
  /** New scrollback lines accrued since follow broke (drives the pill count). */
  const newLinesRef = useRef(0);
  /** rAF handle coalescing pill re-renders (output can fire many times a frame). */
  const pillRafRef = useRef(0);
  /** `null` = pill hidden (following); a number = lines behind (0 ⇒ "Jump to latest"). */
  const [pillCount, setPillCount] = useState<number | null>(null);

  const id = session.id;
  const ptyId = session.ptyId;
  const status = session.status;

  const retrySession = useSessionStore((s) => s.retrySession);

  /** Is the live viewport within BOTTOM_THRESHOLD of the latest line? */
  const isAtBottom = useCallback((term: Terminal): boolean => {
    const buf = term.buffer.active;
    return buf.viewportY >= buf.baseY - BOTTOM_THRESHOLD;
  }, []);

  /** Push follow/new-line state into the pill, coalesced to one update per frame. */
  const schedulePill = useCallback(() => {
    if (pillRafRef.current) return;
    pillRafRef.current = requestAnimationFrame(() => {
      pillRafRef.current = 0;
      setPillCount(followRef.current ? null : newLinesRef.current);
    });
  }, []);

  /** Re-pin to the bottom and resume following (pill click / programmatic). */
  const jumpToLatest = useCallback(() => {
    const term = termRef.current;
    if (!term) return;
    followRef.current = true;
    newLinesRef.current = 0;
    try {
      term.scrollToBottom();
      term.focus();
    } catch {
      /* fail-soft */
    }
    setPillCount(null);
  }, []);

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
      // Deep, cheap scrollback so a long claude run stays fully re-readable.
      scrollback: 10000,
      // Smooth wheel/jump scrolling + a comfortable wheel step. Claude enables no
      // mouse tracking, so the wheel drives xterm's scrollback natively (verified
      // by probe) — these just make it feel right.
      smoothScrollDuration: 120,
      scrollSensitivity: 3,
      fastScrollSensitivity: 5,
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

    // Follow tracking: ANY viewport move (wheel, keyboard PageUp, drag, or our own
    // scrollToBottom) lands here. Scrolling up off the bottom breaks follow and
    // arms the pill; scrolling back to the bottom re-pins and clears it. Driving
    // this purely off the bottom check keeps it robust across input sources.
    const onScrollDisp = term.onScroll(() => {
      const atBottom = isAtBottom(term);
      if (atBottom) {
        if (!followRef.current) {
          followRef.current = true;
          newLinesRef.current = 0;
          schedulePill();
        }
      } else if (followRef.current) {
        followRef.current = false;
        baseAtLeaveRef.current = term.buffer.active.baseY;
        newLinesRef.current = 0;
        schedulePill();
      }
    });

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

    // Clicking anywhere in the terminal grabs the keyboard (you type to claude).
    const onMouseDown = (): void => {
      try {
        term.focus();
      } catch {
        /* fail-soft */
      }
    };
    container.addEventListener('mousedown', onMouseDown);

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
    // Wait for web fonts so xterm measures glyph width with JetBrains Mono loaded
    // (otherwise the first paint can be mis-sized against a fallback metric).
    if (typeof document !== 'undefined' && (document as any).fonts?.ready) {
      (document as any).fonts.ready.then(() => measureAndStart()).catch(() => measureAndStart());
    } else {
      measureAndStart();
    }

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
        // Resize must NOT reset follow: if we were pinned, stay pinned; if the
        // user was reading scrollback, leave their position alone.
        if (followRef.current) t.scrollToBottom();
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
      if (pillRafRef.current) cancelAnimationFrame(pillRafRef.current);
      container.removeEventListener('mousedown', onMouseDown);
      onScrollDisp.dispose();
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

    // A fresh pty (initial spawn or retry) starts pinned to the bottom: the
    // synchronous buffer replay below should land us at the latest line.
    followRef.current = true;
    newLinesRef.current = 0;
    baseAtLeaveRef.current = 0;
    setPillCount(null);

    const unsub = subscribeToPty(ptyId, (chunk) => {
      const t = termRef.current;
      if (!t) return;
      // Write, then settle scroll AFTER xterm has parsed the chunk (baseY is up
      // to date in the callback): keep pinned while following, else tally how far
      // behind we now are so the pill can show "N new lines".
      t.write(chunk, () => {
        if (followRef.current) {
          try {
            t.scrollToBottom();
          } catch {
            /* fail-soft */
          }
        } else {
          newLinesRef.current = Math.max(0, t.buffer.active.baseY - baseAtLeaveRef.current);
          schedulePill();
        }
      });
    });
    return unsub;
  }, [ptyId, schedulePill]);

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
    followRef.current = true;
    newLinesRef.current = 0;
    baseAtLeaveRef.current = 0;
    setPillCount(null);
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
      // Re-pin on re-show only if we were following (don't disturb a reader).
      if (followRef.current) term.scrollToBottom();
      term.focus();
    } catch {
      /* fail-soft */
    }
  }, [active, ptyId]);

  const headerStatus = HEADER_STATUS[session.status];

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden rounded-lg border border-ink-700/70 bg-ink-950">
      {/* Slim terminal-frame header — session title + cwd + model + status. */}
      <div className="flex shrink-0 items-center gap-2 border-b border-ink-700/60 bg-ink-900 px-3 py-2">
        <SquareTerminal size={16} strokeWidth={1.75} className="shrink-0 text-ink-400" />
        <span className="min-w-0 truncate text-[13px] text-ink-100">{session.title}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-ink-500">
          {session.cwd}
        </span>
        {session.model && <span className={HEADER_CHIP}>{session.model}</span>}
        <span className={`flex shrink-0 items-center gap-1.5 text-[11px] ${headerStatus.text}`}>
          <span
            className={`h-1.5 w-1.5 rounded-full ${headerStatus.dot} ${
              headerStatus.pulse ? 'pulse-dot' : ''
            }`}
          />
          {headerStatus.label}
        </span>
        {session.status === 'running' && (
          <button
            type="button"
            aria-label="Stop session"
            title="Stop this session"
            onClick={() => useSessionStore.getState().stopSession(session.id)}
            className="grid h-7 w-7 shrink-0 cursor-pointer place-items-center rounded-md text-ink-400 transition-colors hover:bg-ink-800 hover:text-status-failed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring"
          >
            <Square size={16} strokeWidth={1.75} />
          </button>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col p-3">
        {session.status === 'exited' && (
          <div className="mb-1.5 shrink-0 text-[11px] text-ink-500">
            session exited (code {session.exitCode ?? '?'})
          </div>
        )}
        <div className="relative h-full min-h-0 w-full">
          <div ref={containerRef} className="h-full min-h-0 w-full" />

        {/* Smart auto-scroll pill — only while the user has scrolled up to read. */}
        {session.status === 'running' && pillCount !== null && (
          <button
            type="button"
            onClick={jumpToLatest}
            className="absolute bottom-3 right-3 z-10 flex cursor-pointer items-center gap-1.5 rounded-full bg-accent px-3 py-1.5 text-[11.5px] font-medium text-ink-50 shadow-float transition-colors duration-150 hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring"
          >
            <ChevronDown size={14} strokeWidth={2} />
            <span>
              {pillCount > 0
                ? `${pillCount} new line${pillCount === 1 ? '' : 's'}`
                : 'Jump to latest'}
            </span>
          </button>
        )}

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
                className="mt-4 cursor-pointer rounded-md bg-accent px-3.5 py-1.5 text-[12.5px] font-medium text-ink-50 transition-colors hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring"
              >
                Retry
              </button>
            </div>
          </div>
        )}
        </div>
      </div>
    </div>
  );
}
