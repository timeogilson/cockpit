import { basename } from 'node:path';
import { EMPTY_TOKENS, type TokenCounts } from '@shared/types';

/**
 * Mutable per-session aggregate, folded incrementally from transcript events.
 * One JSONL file == one session (filename is the sessionId).
 */
export interface SessionAggregate {
  sessionId: string;
  filePath: string;
  title?: string;
  titleLocked: boolean;
  model: string;
  cwd: string;
  project: string;
  gitBranch?: string;
  startedAt: number;
  lastActivityAt: number;
  tokens: TokenCounts;
  /** Per-model token totals for events whose timestamp is "today" (local). */
  todayByModel: Map<string, TokenCounts>;
  /** Text of the most recent assistant message (for markers + activity). */
  latestAssistantText: string;
  activityLine?: string;
  hasErrorEvent: boolean;
  isSidechain: boolean;
  eventCount: number;
}

export function createAggregate(sessionId: string, filePath: string): SessionAggregate {
  return {
    sessionId,
    filePath,
    titleLocked: false,
    model: '',
    cwd: '',
    project: '',
    startedAt: 0,
    lastActivityAt: 0,
    tokens: { ...EMPTY_TOKENS },
    todayByModel: new Map(),
    latestAssistantText: '',
    hasErrorEvent: false,
    isSidechain: false,
    eventCount: 0
  };
}

function startOfTodayMs(now = Date.now()): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function truncate(s: string, n: number): string {
  const clean = s.replace(/\s+/g, ' ').trim();
  return clean.length > n ? clean.slice(0, n - 1).trimEnd() + '…' : clean;
}

/** Extract plain text from a message.content that may be a string or block array. */
function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const block of content) {
      if (block && typeof block === 'object' && (block as { type?: string }).type === 'text') {
        const t = (block as { text?: unknown }).text;
        if (typeof t === 'string') parts.push(t);
      }
    }
    return parts.join('\n');
  }
  return '';
}

/** Is this user message a real human turn (not a tool_result / meta echo)? */
function isHumanText(content: unknown): boolean {
  if (typeof content === 'string') return content.trim().length > 0;
  if (Array.isArray(content)) {
    // Skip arrays that are tool results.
    const hasToolResult = content.some(
      (b) => b && typeof b === 'object' && (b as { type?: string }).type === 'tool_result'
    );
    if (hasToolResult) return false;
    return extractText(content).trim().length > 0;
  }
  return false;
}

/** Human-readable activity line from a tool_use block. */
function describeTool(name: string, input: Record<string, unknown> | undefined): string {
  const fp = (input?.file_path ?? input?.path ?? input?.notebook_path) as string | undefined;
  const file = fp ? basename(fp) : undefined;
  switch (name) {
    case 'Edit':
    case 'MultiEdit':
    case 'Write':
    case 'NotebookEdit':
      return file ? `editing ${file}` : 'editing a file';
    case 'Read':
      return file ? `reading ${file}` : 'reading a file';
    case 'Bash': {
      const desc = (input?.description ?? input?.command) as string | undefined;
      return desc ? `running ${truncate(desc, 48)}` : 'running a command';
    }
    case 'Grep':
      return input?.pattern ? `searching "${truncate(String(input.pattern), 32)}"` : 'searching';
    case 'Glob':
      return input?.pattern ? `globbing ${truncate(String(input.pattern), 32)}` : 'globbing';
    case 'Task':
      return `dispatching ${String(input?.subagent_type ?? 'agent')}`;
    case 'TodoWrite':
      return 'updating todos';
    case 'WebFetch':
      return 'fetching the web';
    case 'WebSearch':
      return 'searching the web';
    default:
      return name || 'working';
  }
}

function addInto(map: Map<string, TokenCounts>, model: string, add: TokenCounts): void {
  const key = model || 'unknown';
  const cur = map.get(key) ?? { ...EMPTY_TOKENS };
  cur.input += add.input;
  cur.output += add.output;
  cur.cacheWrite += add.cacheWrite;
  cur.cacheRead += add.cacheRead;
  map.set(key, cur);
}

/**
 * Fold one parsed JSONL object into the aggregate. Defensive throughout —
 * unexpected shapes are ignored, never thrown.
 */
export function foldLine(agg: SessionAggregate, raw: unknown): void {
  if (!raw || typeof raw !== 'object') return;
  const line = raw as {
    type?: string;
    timestamp?: string;
    sessionId?: string;
    isSidechain?: boolean;
    cwd?: string;
    gitBranch?: string;
    level?: string;
    subtype?: string;
    isApiErrorMessage?: boolean;
    message?: {
      role?: string;
      model?: string;
      content?: unknown;
      usage?: {
        input_tokens?: number;
        output_tokens?: number;
        cache_creation_input_tokens?: number;
        cache_read_input_tokens?: number;
      };
    };
  };

  agg.eventCount++;

  const ts = line.timestamp ? Date.parse(line.timestamp) : NaN;
  if (!Number.isNaN(ts)) {
    if (agg.startedAt === 0 || ts < agg.startedAt) agg.startedAt = ts;
    if (ts > agg.lastActivityAt) agg.lastActivityAt = ts;
  }
  if (typeof line.cwd === 'string' && line.cwd) {
    agg.cwd = line.cwd;
    agg.project = basename(line.cwd);
  }
  if (typeof line.gitBranch === 'string' && line.gitBranch) agg.gitBranch = line.gitBranch;
  if (line.isSidechain === true) agg.isSidechain = true;
  if (line.isApiErrorMessage === true) agg.hasErrorEvent = true;
  if (line.type === 'system' && (line.level === 'error' || line.subtype === 'error')) {
    agg.hasErrorEvent = true;
  }

  const msg = line.message;
  if (!msg) return;

  if (line.type === 'user') {
    if (!agg.titleLocked && isHumanText(msg.content)) {
      agg.title = truncate(extractText(msg.content), 90);
      agg.titleLocked = true;
    }
    return;
  }

  if (line.type === 'assistant') {
    if (typeof msg.model === 'string' && msg.model) agg.model = msg.model;

    // Tokens.
    const u = msg.usage;
    if (u) {
      const add: TokenCounts = {
        input: u.input_tokens ?? 0,
        output: u.output_tokens ?? 0,
        cacheWrite: u.cache_creation_input_tokens ?? 0,
        cacheRead: u.cache_read_input_tokens ?? 0
      };
      agg.tokens.input += add.input;
      agg.tokens.output += add.output;
      agg.tokens.cacheWrite += add.cacheWrite;
      agg.tokens.cacheRead += add.cacheRead;
      if (!Number.isNaN(ts) && ts >= startOfTodayMs()) {
        addInto(agg.todayByModel, agg.model, add);
      }
    }

    // Activity line + latest assistant text from this message's content.
    const content = msg.content;
    let lastTool: { name: string; input?: Record<string, unknown> } | undefined;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (!block || typeof block !== 'object') continue;
        const b = block as { type?: string; name?: string; input?: Record<string, unknown> };
        if (b.type === 'tool_use' && typeof b.name === 'string') {
          lastTool = { name: b.name, input: b.input };
        }
      }
    }
    const text = extractText(content);
    if (text.trim()) agg.latestAssistantText = text;

    if (lastTool) {
      agg.activityLine = describeTool(lastTool.name, lastTool.input);
    } else if (text.trim()) {
      agg.activityLine = truncate(text, 80);
    }
  }
}

export { truncate };
