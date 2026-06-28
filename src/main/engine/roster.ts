import { readFileSync } from 'node:fs';
import { rosterPath } from './paths';

export interface RosterWorker {
  shortId: string;
  pid: number;
  sessionId: string;
  startedAt: number;
  cwd: string;
  cliVersion: string;
  dispatch?: Record<string, unknown>;
}

export interface Roster {
  supervisorPid: number;
  updatedAt: number;
  workers: RosterWorker[];
}

const EMPTY: Roster = { supervisorPid: 0, updatedAt: 0, workers: [] };

/**
 * RosterParser — reads daemon/roster.json (the currently-active sessions).
 * Fail-soft: a missing or malformed file yields zero active workers, never throws.
 */
export function readRoster(): Roster {
  let text: string;
  try {
    text = readFileSync(rosterPath(), 'utf8');
  } catch {
    // File absent → no active agents. Normal state, not an error.
    return EMPTY;
  }

  try {
    const raw = JSON.parse(text) as {
      supervisorPid?: number;
      updatedAt?: number;
      workers?: Record<string, Partial<RosterWorker> & { pid?: number }>;
    };
    const workers: RosterWorker[] = [];
    for (const [shortId, w] of Object.entries(raw.workers ?? {})) {
      if (!w || typeof w.pid !== 'number') continue;
      workers.push({
        shortId,
        pid: w.pid,
        sessionId: typeof w.sessionId === 'string' ? w.sessionId : '',
        startedAt: typeof w.startedAt === 'number' ? w.startedAt : 0,
        cwd: typeof w.cwd === 'string' ? w.cwd : '',
        cliVersion: typeof w.cliVersion === 'string' ? w.cliVersion : '',
        dispatch:
          w.dispatch && typeof w.dispatch === 'object'
            ? (w.dispatch as Record<string, unknown>)
            : undefined
      });
    }
    return {
      supervisorPid: typeof raw.supervisorPid === 'number' ? raw.supervisorPid : 0,
      updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : 0,
      workers
    };
  } catch (err) {
    console.error('[engine] roster.json parse failed (fail-soft):', (err as Error).message);
    return EMPTY;
  }
}

/** Best-effort liveness check for a pid (does not signal the process). */
export function isPidAlive(pid: number): boolean {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM = exists but not ours; ESRCH = gone.
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}
