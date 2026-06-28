import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Resolve the user's Claude Code data directory.
 * Honors CLAUDE_CONFIG_DIR if set, else ~/.claude.
 * All access is READ-ONLY.
 */
export function claudeDir(): string {
  const override = process.env.CLAUDE_CONFIG_DIR?.trim();
  if (override) return override;
  return join(homedir(), '.claude');
}

export function rosterPath(): string {
  return join(claudeDir(), 'daemon', 'roster.json');
}

export function sessionsDir(): string {
  return join(claudeDir(), 'sessions');
}

export function projectsDir(): string {
  return join(claudeDir(), 'projects');
}
