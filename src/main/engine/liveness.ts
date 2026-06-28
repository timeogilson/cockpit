import type { AgentStatus } from '@shared/types';

/** A worker is "busy" if it produced an event within this window. */
export const BUSY_WINDOW_MS = 20_000;

export interface Markers {
  result: boolean;
  needsInput: boolean;
  failed: boolean;
}

/**
 * Scan the latest assistant message text for line-leading marker lines
 * (case-insensitive): `result:`, `needs input:`, `failed:`.
 */
export function scanMarkers(latestAssistantText: string): Markers {
  const out: Markers = { result: false, needsInput: false, failed: false };
  if (!latestAssistantText) return out;
  for (const rawLine of latestAssistantText.split('\n')) {
    const line = rawLine.trim().toLowerCase();
    if (line.startsWith('needs input:')) out.needsInput = true;
    else if (line.startsWith('failed:')) out.failed = true;
    else if (line.startsWith('result:')) out.result = true;
  }
  return out;
}

export interface LivenessInput {
  hasLiveWorker: boolean;
  lastActivityAt: number;
  latestAssistantText: string;
  hasErrorEvent: boolean;
  now: number;
}

/**
 * Liveness state machine (design spec §4). Fuses three weak signals:
 * roster worker presence, transcript recency, and marker lines.
 */
export function deriveStatus(input: LivenessInput): AgentStatus {
  const { hasLiveWorker, lastActivityAt, latestAssistantText, hasErrorEvent, now } = input;
  const markers = scanMarkers(latestAssistantText);

  if (hasLiveWorker) {
    return now - lastActivityAt < BUSY_WINDOW_MS ? 'busy' : 'idle';
  }
  // No live worker → terminal-ish states.
  if (markers.needsInput) return 'needs-input';
  if (markers.failed || hasErrorEvent) return 'failed';
  return 'done';
}
