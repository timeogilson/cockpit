import { Notification, type BrowserWindow } from 'electron';

import type { Agent, AgentStatus } from '@shared/types';
import type { NotifyConfig } from '@shared/control';
import { DEFAULT_NOTIFY_CONFIG } from '@shared/control';
import type { EngineSnapshot } from './engine';
import { readJsonFile, writeJsonFile } from './configStore';

/**
 * Notifications (design spec §7) — diff successive engine snapshots and fire
 * native notifications on status transitions (→ needs-input / done / failed) and
 * on a daily budget crossing. Fail-soft: any error is logged, never thrown.
 *
 * Preferences live in %APPDATA%/Cockpit/config.json under the `notify` key.
 */

const CONFIG_FILE = 'config.json';

interface PersistedConfig {
  notify?: Partial<NotifyConfig>;
}

let getWindow: () => BrowserWindow | null = () => null;
let config: NotifyConfig = { ...DEFAULT_NOTIFY_CONFIG };

/** Previous status per sessionId, to detect transitions. */
const prevStatus = new Map<string, AgentStatus>();
let seeded = false; // skip notifications for the very first snapshot

/** Day-string (local) we last fired a budget alert, so it fires once/day. */
let budgetNotifiedDay = '';

const TERMINAL_EVENTS: AgentStatus[] = ['needs-input', 'done', 'failed'];

function loadConfig(): NotifyConfig {
  const raw = readJsonFile<PersistedConfig>(CONFIG_FILE, {});
  return { ...DEFAULT_NOTIFY_CONFIG, ...(raw.notify ?? {}) };
}

function persistConfig(): void {
  const raw = readJsonFile<PersistedConfig>(CONFIG_FILE, {});
  writeJsonFile(CONFIG_FILE, { ...raw, notify: config });
}

export function initNotifications(getWin: () => BrowserWindow | null): void {
  getWindow = getWin;
  config = loadConfig();
}

export function getNotifyConfig(): NotifyConfig {
  return { ...config };
}

export function setNotifyConfig(partial: Partial<NotifyConfig>): NotifyConfig {
  config = { ...config, ...(partial ?? {}) };
  persistConfig();
  return getNotifyConfig();
}

function shouldNotify(status: AgentStatus): boolean {
  if (status === 'needs-input') return config.needsInput;
  if (status === 'done') return config.done;
  if (status === 'failed') return config.failed;
  return false;
}

function titleFor(status: AgentStatus): string {
  switch (status) {
    case 'needs-input':
      return 'Agent needs your input';
    case 'done':
      return 'Agent finished';
    case 'failed':
      return 'Agent failed';
    default:
      return 'Agent update';
  }
}

function fire(title: string, body: string): void {
  try {
    if (!Notification.isSupported()) return;
    const n = new Notification({ title, body, silent: false });
    n.on('click', () => {
      const win = getWindow();
      if (!win || win.isDestroyed()) return;
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    });
    n.show();
  } catch (err) {
    console.error('[notifications] fire failed (fail-soft):', (err as Error).message);
  }
}

function todayKey(): string {
  return new Date().toDateString();
}

/** Hook called from the snapshot push path on every engine snapshot. */
export function onSnapshot(snap: EngineSnapshot): void {
  try {
    diffTransitions(snap.agents.agents);
    checkBudget(snap.usage.today.costUsd);
  } catch (err) {
    console.error('[notifications] onSnapshot failed (fail-soft):', (err as Error).message);
  }
}

function diffTransitions(agents: Agent[]): void {
  const seen = new Set<string>();
  for (const a of agents) {
    seen.add(a.sessionId);
    const before = prevStatus.get(a.sessionId);
    prevStatus.set(a.sessionId, a.status);
    if (!seeded) continue; // first snapshot: seed only, no notifications
    if (before === a.status) continue;
    if (!TERMINAL_EVENTS.includes(a.status)) continue;
    if (!shouldNotify(a.status)) continue;
    fire(titleFor(a.status), a.title || a.project || a.sessionId.slice(0, 8));
  }
  // Forget sessions that fell out of the snapshot so re-appearance can re-notify.
  for (const id of [...prevStatus.keys()]) {
    if (!seen.has(id)) prevStatus.delete(id);
  }
  seeded = true;
}

function checkBudget(todayCost: number): void {
  if (!config.budgetEnabled || config.budgetUsd <= 0) return;
  const day = todayKey();
  if (budgetNotifiedDay === day) return; // already alerted today
  if (todayCost >= config.budgetUsd) {
    budgetNotifiedDay = day;
    fire(
      'Daily budget crossed',
      `Today's spend ($${todayCost.toFixed(2)}) crossed your $${config.budgetUsd.toFixed(2)} budget.`
    );
  }
}
