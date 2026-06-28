// Control + notification contract — shared by main (Controller, notifications)
// and renderer (launch dialog, agent-card actions, settings panel).
// Kept separate from types.ts/ipc.ts so the M4/M6 surface is additive and a
// future Codex adapter can reuse the same launch/stop vocabulary.

/** Effort levels the real `claude --effort` flag accepts. */
export type EffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export const EFFORT_LEVELS: readonly EffortLevel[] = ['low', 'medium', 'high', 'xhigh', 'max'];

/** Model aliases offered in the launch dialog (full names also accepted). */
export const MODEL_CHOICES: readonly string[] = ['opus', 'sonnet', 'haiku', 'fable'];

export interface LaunchRequest {
  /** Working directory the agent runs in. */
  cwd: string;
  /** The prompt / task text. */
  prompt: string;
  /** Model alias ('opus'/'sonnet'/…) or full id; omit for the user's default. */
  model?: string;
  effort?: EffortLevel;
  /** Background agent (`--background`) vs foreground one-shot (`--print`). */
  background?: boolean;
  /** Optional display name (`--name`). */
  name?: string;
}

export interface LaunchResult {
  ok: boolean;
  /** Session id assigned via `--session-id` (usable for follow-up/resume). */
  sessionId?: string;
  /** OS pid of the spawned child, when available. */
  pid?: number;
  /** The exact argv the controller built (for transparency / dry-run). */
  argv?: string[];
  /** True when the controller only logged the argv and did not spawn. */
  dryRun?: boolean;
  error?: string;
}

export interface StopRequest {
  pid?: number;
  sessionId?: string;
}

export interface StopResult {
  ok: boolean;
  /** Pids the controller issued a kill for. */
  killed?: number[];
  dryRun?: boolean;
  error?: string;
}

export interface FollowUpRequest {
  sessionId: string;
  message: string;
}

export interface FollowUpResult {
  ok: boolean;
  sessionId?: string;
  pid?: number;
  argv?: string[];
  dryRun?: boolean;
  error?: string;
}

export interface DispatchRequest {
  tasks: LaunchRequest[];
}

export interface DispatchResult {
  ok: boolean;
  results: LaunchResult[];
}

/** A saved prompt preset persisted in %APPDATA%/Cockpit/templates.json. */
export interface PromptTemplate {
  id: string;
  name: string;
  prompt: string;
  model?: string;
  effort?: EffortLevel;
  background?: boolean;
  createdAt: number;
}

export interface TemplatesList {
  templates: PromptTemplate[];
}

export interface SaveTemplateRequest {
  /** Provide to overwrite an existing preset; omit to create a new one. */
  id?: string;
  name: string;
  prompt: string;
  model?: string;
  effort?: EffortLevel;
  background?: boolean;
}

/** Notification preferences persisted in %APPDATA%/Cockpit/config.json. */
export interface NotifyConfig {
  /** Notify when an agent transitions to needs-input. */
  needsInput: boolean;
  /** Notify when an agent transitions to done. */
  done: boolean;
  /** Notify when an agent transitions to failed. */
  failed: boolean;
  /** Notify once/day when today's spend crosses budgetUsd. */
  budgetEnabled: boolean;
  /** Daily budget threshold in USD. */
  budgetUsd: number;
}

export const DEFAULT_NOTIFY_CONFIG: NotifyConfig = {
  needsInput: true,
  done: true,
  failed: true,
  budgetEnabled: false,
  budgetUsd: 25
};
