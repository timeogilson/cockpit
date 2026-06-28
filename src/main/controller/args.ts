import type { LaunchRequest } from '@shared/control';

/**
 * Pure argv builders for the real `claude` CLI — no electron / fs deps, so they
 * can be exercised in isolation (the controller delegates to these).
 *
 * Flags confirmed via `claude --help`:
 *   --session-id <uuid>   assign a known session id (so we can resume it)
 *   --background | --print  background daemon agent vs non-interactive one-shot
 *   --model <m>           alias ('opus'/'sonnet'/…) or full id
 *   --effort <level>      low | medium | high | xhigh | max
 *   --name <n>            display name
 *   --resume <id>         resume a conversation by session id
 *   --                    end-of-options guard before the positional prompt
 */

export function buildLaunchArgs(req: LaunchRequest, sessionId: string): string[] {
  const args: string[] = ['--session-id', sessionId];
  // Electron main has no TTY → foreground must be --print (non-interactive).
  args.push(req.background ? '--background' : '--print');
  if (req.model && req.model.trim()) args.push('--model', req.model.trim());
  if (req.effort) args.push('--effort', req.effort);
  if (req.name && req.name.trim()) args.push('--name', req.name.trim());
  args.push('--', req.prompt);
  return args;
}

export function buildResumeArgs(sessionId: string, message: string): string[] {
  return ['--resume', sessionId, '--print', '--', message];
}
