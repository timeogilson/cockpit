import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import type { PtySession } from '../../store/useSessionStore';
import { subscribeToPty } from '../../store/useSessionStore';

/**
 * TerminalPane — one xterm.js terminal bound to a single live PTY.
 *
 * The Terminal + FitAddon are held in refs so they persist across renders. The
 * pty is wired in a once-only mount effect: input → `pty:write`, output via
 * `subscribeToPty` (which synchronously replays the buffered-so-far output, then
 * streams). A ResizeObserver keeps cols/rows in sync with the container and
 * forwards `pty:resize`. Fitting a hidden (display:none) element yields wrong
 * dimensions, so we only fit when the pane is actually `active` (visible).
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

  const id = session.id;

  // ---- mount: build the terminal + wire the pty (once) --------------------
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const term = new Terminal({
      fontFamily: "'Cascadia Code', Consolas, 'SFMono-Regular', monospace",
      fontSize: 13,
      cursorBlink: true,
      theme: { ...TERM_THEME }
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(container);
    termRef.current = term;
    fitRef.current = fit;

    // Input → pty.
    const onDataDisp = term.onData((d: string) => {
      try {
        void window.cockpit?.invoke('pty:write', { id, data: d });
      } catch {
        /* fail-soft */
      }
    });

    // Output → terminal (replays buffer, then streams).
    const unsub = subscribeToPty(id, (chunk) => term.write(chunk));

    // Keep the viewport sized to the container; forward the new geometry.
    const doFit = (): void => {
      const el = containerRef.current;
      if (!el || el.clientWidth <= 0 || el.clientHeight <= 0) return;
      try {
        fit.fit();
        void window.cockpit?.invoke('pty:resize', { id, cols: term.cols, rows: term.rows });
      } catch {
        /* fail-soft — a transient zero-size layout shouldn't throw */
      }
    };

    doFit();
    const ro = new ResizeObserver(() => doFit());
    ro.observe(container);

    return () => {
      onDataDisp.dispose();
      unsub();
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

  // ---- when this pane becomes active: it now has layout → fit + focus -----
  useEffect(() => {
    if (!active) return;
    const term = termRef.current;
    const fit = fitRef.current;
    const el = containerRef.current;
    if (!term || !fit || !el) return;
    if (el.clientWidth <= 0 || el.clientHeight <= 0) return;
    try {
      fit.fit();
      void window.cockpit?.invoke('pty:resize', { id, cols: term.cols, rows: term.rows });
      term.focus();
    } catch {
      /* fail-soft */
    }
  }, [active, id]);

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden rounded-lg border border-ink-700/70 bg-ink-950 p-3">
      {session.status === 'exited' && (
        <div className="mb-1.5 shrink-0 text-[11px] text-ink-500">
          session exited (code {session.exitCode ?? '?'})
        </div>
      )}
      <div ref={containerRef} className="h-full min-h-0 w-full" />
    </div>
  );
}
