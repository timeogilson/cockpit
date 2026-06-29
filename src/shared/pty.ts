// Shared PTY wire types — the typed contract for the embedded-terminal seam.
// Imported by main (PtyManager + IPC handlers), and (later) the renderer.
//
// A PTY is a real pseudo-terminal spawned in the main process via node-pty.
// The renderer drives it through request/response commands (`pty:create`,
// `pty:write`, `pty:resize`, `pty:kill`) and receives streamed output via the
// pushed `pty:data` / `pty:exit` channels.

/** Renderer → main: open a new pseudo-terminal. */
export interface PtyCreateRequest {
  /** Working directory the shell starts in. */
  cwd: string;
  /** Shell/binary to launch. Defaults to the platform shell when omitted. */
  shell?: string;
  /** argv for the shell. */
  args?: string[];
  /** Initial terminal width in columns. */
  cols: number;
  /** Initial terminal height in rows. */
  rows: number;
  /** Extra environment, merged over `process.env`. */
  env?: Record<string, string>;
  /** Only honored when `shell:'claude'`; main builds the claude argv from these. */
  model?: string;
  /** Only honored when `shell:'claude'`; main builds the claude argv from these. */
  prompt?: string;
}

/** Main → renderer: result of a create request (fail-soft, never throws). */
export interface PtyCreateResult {
  ok: boolean;
  /** Opaque id of the spawned pty, present when `ok`. */
  id?: string;
  /** Human-readable error, present when `!ok`. */
  error?: string;
  /**
   * The absolute executable path main actually resolved/spawned (the `claude`
   * binary for `shell:'claude'`, else the shell). Surfaced so the renderer can
   * show it in a failure pane — never a silent blank terminal.
   */
  resolvedPath?: string;
}

/** Renderer → main: write keystrokes/data to a pty. */
export interface PtyWriteRequest {
  id: string;
  data: string;
}

/** Renderer → main: resize a pty's viewport. */
export interface PtyResizeRequest {
  id: string;
  cols: number;
  rows: number;
}

/** Renderer → main: terminate a pty. */
export interface PtyKillRequest {
  id: string;
}

/** Main → renderer (pushed): a chunk of output from a pty. */
export interface PtyDataEvent {
  id: string;
  chunk: string;
}

/** Main → renderer (pushed): a pty exited (and was removed from the manager). */
export interface PtyExitEvent {
  id: string;
  code: number;
}
