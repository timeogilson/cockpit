import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';

/**
 * Fail-soft JSON persistence for Cockpit's own data under the app's userData
 * directory (Windows: %APPDATA%/Cockpit). NEVER touches ~/.claude.
 *
 * Every read returns the provided fallback on any error; every write swallows
 * errors after logging — persistence is best-effort and must never crash main.
 */

/** Absolute path to Cockpit's writable data dir, created on demand. */
export function userDataDir(): string {
  // app.getPath('userData') resolves to %APPDATA%/<productName> on Windows.
  const dir = app.getPath('userData');
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    /* best-effort */
  }
  return dir;
}

export function configFilePath(name: string): string {
  return join(userDataDir(), name);
}

export function readJsonFile<T>(name: string, fallback: T): T {
  try {
    const text = readFileSync(configFilePath(name), 'utf8');
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === 'object') return parsed as T;
    return fallback;
  } catch {
    // Missing/corrupt → fallback. Normal on first run.
    return fallback;
  }
}

export function writeJsonFile(name: string, data: unknown): boolean {
  const target = configFilePath(name);
  const tmp = `${target}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    renameSync(tmp, target); // atomic-ish replace
    return true;
  } catch (err) {
    console.error(`[configStore] write failed for ${name} (fail-soft):`, (err as Error).message);
    return false;
  }
}
