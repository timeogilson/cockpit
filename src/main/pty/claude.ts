// Claude executable resolution + interactive argv builder for the embedded
// session-shell terminal.
//
// ──────────────────────────────────────────────────────────────────────────
// WHY THIS LIVES IN MAIN (the Windows-ConPTY-absolute-path rationale)
// ──────────────────────────────────────────────────────────────────────────
// node-pty on Windows spawns through ConPTY, which does NOT PATH-resolve a bare
// command name the way a shell would: handing it `claude` fails to launch
// because ConPTY needs an ABSOLUTE executable path. The renderer cannot resolve
// PATH (no Node `child_process`, and the browser has no idea where npm-global
// lives), so resolution MUST happen in the main process — here — and the
// already-absolute path is then passed to `PtyManager.create({ shell })`.
//
// This module deliberately imports NOTHING from electron; it only uses node's
// `child_process` / `fs` / `os` / `path` so it stays trivially unit-testable and
// independent of the app lifecycle. It is fail-soft everywhere: any throw or
// missing binary degrades to `null`, and the IPC layer turns that into a
// `{ ok:false, error }` toast rather than a crash.

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/** Memoized successful resolution. Re-resolved while still `null`. */
let cached: string | null = null;

/**
 * Resolve the ABSOLUTE path to the `claude` executable, or `null` when nothing
 * usable is found. The order is, in priority:
 *
 *   1. `COCKPIT_CLAUDE_BIN` override (same env convention as the Controller's
 *      `claudeBin()`), when it points at a file that exists.
 *   2. `where claude` (win32) / `which claude` (POSIX), spawned WITHOUT a shell.
 *      On Windows we prefer a `.exe`, then `.cmd`, then `.bat`, else the first
 *      existing line.
 *   3. Common npm-global / install locations (best-effort probes).
 *   4. `null`.
 *
 * The first success is memoized (a prior `null` does not poison later calls —
 * the user may install claude while Cockpit is open).
 *
 * See the file header for why an absolute path is required (Windows ConPTY).
 */
export function resolveClaudePath(): string | null {
  if (cached) return cached;

  // 1) Explicit override — mirrors the Controller's COCKPIT_CLAUDE_BIN.
  const override = process.env.COCKPIT_CLAUDE_BIN?.trim();
  if (override && fileExists(override)) {
    cached = override;
    return cached;
  }

  // 2) Ask the OS resolver (no shell string — args array, fail-soft).
  const fromWhich = resolveViaWhich();
  if (fromWhich) {
    cached = fromWhich;
    return cached;
  }

  // 3) Probe well-known install locations.
  const fromProbe = probeCommonLocations();
  if (fromProbe) {
    cached = fromProbe;
    return cached;
  }

  // 4) Give up (stays null so a later call re-resolves).
  return null;
}

/** `where claude` / `which claude`, picking the best existing line. */
function resolveViaWhich(): string | null {
  const isWin = process.platform === 'win32';
  try {
    // NOTE: capture as a Buffer (no `encoding`). `where` prints in the console
    // OEM codepage, so an accented home path (e.g. "C:\Users\Timéo\...") gets
    // mangled when force-decoded as utf8 — the mangled path then fails
    // `fileExists` and resolution silently returns null. Decode as BOTH utf8 and
    // latin1 and keep whichever lines actually point at a file on disk.
    const res = spawnSync(isWin ? 'where' : 'which', ['claude'], {});
    const out = res.stdout;
    const decode = (enc: BufferEncoding): string[] =>
      (Buffer.isBuffer(out) ? out.toString(enc) : typeof out === 'string' ? out : '')
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
    const lines = [...new Set([...decode('utf8'), ...decode('latin1')])];
    if (lines.length === 0) return null;

    if (isWin) {
      // Prefer a real .exe, then .cmd, then .bat, else the first existing line.
      const byExt = (ext: string): string | undefined =>
        lines.find((l) => l.toLowerCase().endsWith(ext) && fileExists(l));
      const preferred = byExt('.exe') ?? byExt('.cmd') ?? byExt('.bat');
      if (preferred) return preferred;
    }
    return lines.find((l) => fileExists(l)) ?? null;
  } catch {
    // Fail-soft: a missing `where`/`which` or any spawn error → no resolution.
    return null;
  }
}

/** First existing path among the common npm-global / install locations. */
function probeCommonLocations(): string | null {
  const home = os.homedir();
  const candidates =
    process.platform === 'win32'
      ? [
          // Known-good location on this machine — listed first so resolution
          // never depends on `where`'s codepage decoding.
          path.join(home, '.local', 'bin', 'claude.exe'),
          path.join(home, '.local', 'bin', 'claude.cmd'),
          path.join(process.env.APPDATA ?? '', 'npm', 'claude.cmd'),
          path.join(process.env.APPDATA ?? '', 'npm', 'claude.exe'),
          path.join(home, '.claude', 'local', 'claude.exe'),
          path.join(home, '.claude', 'local', 'claude.cmd'),
          path.join(home, 'AppData', 'Local', 'Microsoft', 'WindowsApps', 'claude.exe')
        ]
      : [
          '/usr/local/bin/claude',
          '/opt/homebrew/bin/claude',
          path.join(home, '.local/bin/claude'),
          path.join(home, '.npm-global/bin/claude'),
          path.join(home, '.claude/local/claude')
        ];
  return candidates.find((p) => fileExists(p)) ?? null;
}

/** `fs.existsSync` guarded against empty strings and unexpected throws. */
function fileExists(p: string): boolean {
  if (!p) return false;
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

/**
 * Build the INTERACTIVE argv for `claude`. This is for an attached pseudo-
 * terminal session — it must NEVER pass `--print`/`-p` (which would make claude
 * run headless and exit instead of opening the interactive REPL).
 *
 *   - `--model <m>`   when a model is provided.
 *   - `-- <prompt>`   when an initial prompt is provided. The bare `--` guards a
 *                     prompt that starts with `-`; claude treats the trailing
 *                     positional as the initial prompt to seed the session.
 *
 * Kept minimal / best-effort. NOTE: the precise interactive flag set should be
 * verified LIVE against the installed `claude --help`; flags drift between CLI
 * versions and cannot be exercised from this build step.
 */
export function buildClaudeArgs(opts: { model?: string; prompt?: string }): string[] {
  const args: string[] = [];
  const model = opts.model?.trim();
  if (model) {
    args.push('--model', model);
  }
  const prompt = opts.prompt?.trim();
  if (prompt) {
    args.push('--', prompt);
  }
  return args;
}
