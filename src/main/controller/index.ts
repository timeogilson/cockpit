import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';

import type {
  DispatchRequest,
  DispatchResult,
  FollowUpRequest,
  FollowUpResult,
  LaunchRequest,
  LaunchResult,
  PromptTemplate,
  SaveTemplateRequest,
  StopRequest,
  StopResult,
  TemplatesList
} from '@shared/control';
import { readJsonFile, writeJsonFile } from '../configStore';
import { buildLaunchArgs, buildResumeArgs } from './args';

/**
 * Controller — the control half (design spec §5). Spawns / stops / resumes the
 * real `claude` CLI. The engine remains read-only over ~/.claude; the controller
 * only *spawns processes*, it never writes into ~/.claude.
 *
 * Real CLI flags (discovered via `claude --help`):
 *   launch    : claude --session-id <uuid> [--background | --print] \
 *                      [--model <m>] [--effort <low|medium|high|xhigh|max>] \
 *                      [--name <n>] "<prompt>"
 *   stop      : Windows tree-kill `taskkill /PID <pid> /T /F`; POSIX SIGTERM
 *   follow-up : claude --resume <sessionId> --print "<message>"
 *
 * SAFETY: set COCKPIT_DRY_RUN=1 to build + log argv WITHOUT spawning. Every
 * destructive action (spawn, kill) is logged. Failures are returned as
 * { ok:false, error } so the renderer can surface a toast — never thrown.
 */

const TEMPLATES_FILE = 'templates.json';

/** Executable to invoke; overridable for tests/non-standard installs. */
function claudeBin(): string {
  return process.env.COCKPIT_CLAUDE_BIN?.trim() || 'claude';
}

function isDryRun(): boolean {
  return process.env.COCKPIT_DRY_RUN === '1';
}

interface TrackedChild {
  sessionId: string;
  pid: number;
  child: ChildProcess;
  background: boolean;
  startedAt: number;
}

export class Controller {
  /** sessionId -> tracked child we spawned. */
  private bySession = new Map<string, TrackedChild>();
  /** pid -> sessionId, for stop-by-pid lookups. */
  private byPid = new Map<number, string>();

  // ---- launch -------------------------------------------------------------

  launch(req: LaunchRequest): LaunchResult {
    if (!req || typeof req.prompt !== 'string' || !req.prompt.trim()) {
      return { ok: false, error: 'A non-empty prompt is required.' };
    }
    if (!req.cwd || typeof req.cwd !== 'string') {
      return { ok: false, error: 'A working directory (cwd) is required.' };
    }

    const sessionId = randomUUID();
    const argv = buildLaunchArgs(req, sessionId);
    const printable = [claudeBin(), ...argv].join(' ');

    if (isDryRun()) {
      console.error(`[controller] DRY-RUN launch (cwd=${req.cwd}): ${printable}`);
      return { ok: true, sessionId, argv, dryRun: true };
    }

    console.error(`[controller] LAUNCH (cwd=${req.cwd}): ${printable}`);
    try {
      const child = spawn(claudeBin(), argv, {
        cwd: req.cwd,
        windowsHide: true,
        // Detach background agents so they outlive a Cockpit restart.
        detached: !!req.background,
        stdio: 'ignore'
      });
      const pid = child.pid ?? 0;
      child.on('error', (err) =>
        console.error(`[controller] launch child error (${sessionId}):`, err.message)
      );
      child.on('exit', (code) => {
        console.error(`[controller] launch child exited (${sessionId}) code=${code}`);
        this.untrack(sessionId);
      });
      if (pid) this.track({ sessionId, pid, child, background: !!req.background, startedAt: Date.now() });
      if (req.background) child.unref();
      return { ok: true, sessionId, pid: pid || undefined, argv };
    } catch (err) {
      const error = (err as Error).message;
      console.error(`[controller] launch failed (${sessionId}):`, error);
      return { ok: false, sessionId, argv, error };
    }
  }

  dispatchMany(req: DispatchRequest): DispatchResult {
    const tasks = Array.isArray(req?.tasks) ? req.tasks : [];
    if (tasks.length === 0) return { ok: false, results: [] };
    console.error(`[controller] DISPATCH ${tasks.length} task(s)`);
    const results = tasks.map((t) => this.launch(t));
    return { ok: results.every((r) => r.ok), results };
  }

  // ---- follow-up / resume -------------------------------------------------

  followUp(req: FollowUpRequest): FollowUpResult {
    if (!req || !req.sessionId) return { ok: false, error: 'sessionId is required.' };
    if (typeof req.message !== 'string' || !req.message.trim()) {
      return { ok: false, error: 'A non-empty message is required.' };
    }
    const argv = buildResumeArgs(req.sessionId, req.message);
    const printable = [claudeBin(), ...argv].join(' ');

    // `--resume` reloads the session's own cwd from its transcript, so we don't
    // need to set spawn cwd here (works for external sessions too).
    if (isDryRun()) {
      console.error(`[controller] DRY-RUN follow-up (${req.sessionId}): ${printable}`);
      return { ok: true, sessionId: req.sessionId, argv, dryRun: true };
    }

    console.error(`[controller] FOLLOW-UP (${req.sessionId}): ${printable}`);
    try {
      const child = spawn(claudeBin(), argv, { windowsHide: true, stdio: 'ignore' });
      child.on('error', (err) =>
        console.error(`[controller] follow-up child error (${req.sessionId}):`, err.message)
      );
      return { ok: true, sessionId: req.sessionId, pid: child.pid ?? undefined, argv };
    } catch (err) {
      const error = (err as Error).message;
      console.error(`[controller] follow-up failed (${req.sessionId}):`, error);
      return { ok: false, sessionId: req.sessionId, argv, error };
    }
  }

  /** Alias matching the spec's `resume` verb. */
  resume(req: FollowUpRequest): FollowUpResult {
    return this.followUp(req);
  }

  // ---- stop / kill --------------------------------------------------------

  stop(req: StopRequest): StopResult {
    const pids = new Set<number>();
    if (typeof req?.pid === 'number' && req.pid > 0) pids.add(req.pid);
    if (req?.sessionId) {
      const tracked = this.bySession.get(req.sessionId);
      if (tracked?.pid) pids.add(tracked.pid);
      else if (!req.pid) {
        return {
          ok: false,
          error: `Session ${req.sessionId} was not launched by Cockpit; pass a pid to stop it.`
        };
      }
    }
    if (pids.size === 0) return { ok: false, error: 'No pid or known sessionId to stop.' };

    const list = [...pids];
    if (isDryRun()) {
      console.error(`[controller] DRY-RUN stop pids=${list.join(',')}`);
      return { ok: true, killed: list, dryRun: true };
    }

    const killed: number[] = [];
    let lastErr: string | undefined;
    for (const pid of list) {
      try {
        console.error(`[controller] STOP — tree-killing pid ${pid}`);
        this.killPid(pid);
        killed.push(pid);
      } catch (err) {
        lastErr = (err as Error).message;
        console.error(`[controller] stop failed for pid ${pid}:`, lastErr);
      }
      if (req?.sessionId) this.untrack(req.sessionId);
      this.byPid.delete(pid);
    }
    return { ok: killed.length > 0, killed, error: killed.length ? undefined : lastErr };
  }

  /** Platform tree-kill: Windows `taskkill /T /F`, POSIX SIGTERM. */
  private killPid(pid: number): void {
    if (process.platform === 'win32') {
      const r = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true });
      r.on('error', (err) => console.error(`[controller] taskkill error pid ${pid}:`, err.message));
    } else {
      try {
        process.kill(pid, 'SIGTERM');
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ESRCH') throw err;
      }
    }
  }

  // ---- templates ----------------------------------------------------------

  listTemplates(): TemplatesList {
    const raw = readJsonFile<TemplatesList>(TEMPLATES_FILE, { templates: [] });
    const templates = Array.isArray(raw.templates) ? raw.templates : [];
    return { templates };
  }

  saveTemplate(req: SaveTemplateRequest): TemplatesList {
    if (!req || !req.name?.trim() || !req.prompt?.trim()) {
      // Fail-soft: return current list unchanged on invalid input.
      return this.listTemplates();
    }
    const { templates } = this.listTemplates();
    const now = Date.now();
    const id = req.id?.trim() || randomUUID();
    const next: PromptTemplate = {
      id,
      name: req.name.trim(),
      prompt: req.prompt,
      model: req.model,
      effort: req.effort,
      background: req.background,
      createdAt: now
    };
    const idx = templates.findIndex((t) => t.id === id);
    if (idx >= 0) templates[idx] = { ...next, createdAt: templates[idx].createdAt };
    else templates.push(next);
    writeJsonFile(TEMPLATES_FILE, { templates });
    return { templates };
  }

  // ---- tracking -----------------------------------------------------------

  private track(t: TrackedChild): void {
    this.bySession.set(t.sessionId, t);
    this.byPid.set(t.pid, t.sessionId);
  }

  private untrack(sessionId: string): void {
    const t = this.bySession.get(sessionId);
    if (t) this.byPid.delete(t.pid);
    this.bySession.delete(sessionId);
  }

  /** Best-effort kill of everything we launched (called on app quit). */
  stopAll(): void {
    for (const sessionId of [...this.bySession.keys()]) {
      const t = this.bySession.get(sessionId);
      if (t && !t.background) {
        try {
          this.killPid(t.pid);
        } catch {
          /* best-effort */
        }
      }
      this.untrack(sessionId);
    }
  }
}

let singleton: Controller | null = null;

export function getController(): Controller {
  if (!singleton) singleton = new Controller();
  return singleton;
}
