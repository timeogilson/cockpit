// On-demand transcript detail — the engine half of M3's detail drawer.
//
// Given a sessionId, locate its `.jsonl` under ~/.claude/projects, parse it
// fail-soft, and produce an ordered, condensed event list plus derived
// files-touched, cost breakdown, and a subagent tree. READ-ONLY throughout.
//
// Subagent linkage uses the on-disk layout (confirmed by inspection):
//   projects/<enc>/<sessionId>.jsonl            ← the parent transcript
//   projects/<enc>/<sessionId>/subagents/*.jsonl ← sidechain subagents
//   projects/<enc>/<sessionId>/workflows/**/*.jsonl
// i.e. the directory named after the parent sessionId holds its children — no
// fuzzy parentUuid matching across files is required.

import { closeSync, openSync, readSync, readdirSync, existsSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

import { EMPTY_TOKENS, type TokenCounts } from '@shared/types';
import { computeCost } from '@shared/pricing';
import type {
  CostBreakdown,
  FileTouched,
  SubagentNode,
  ToolUseSummary,
  TranscriptDetail,
  TranscriptEvent,
  TranscriptEventKind
} from '@shared/transcript';

import { projectsDir } from './paths';
import { truncate } from './transcript';

/** Max renderable events shipped to the UI (tokens/files are tallied from all lines). */
const MAX_EVENTS = 1500;
/** Hard cap on lines parsed from one file, to bound memory on pathological transcripts. */
const MAX_LINES = 60_000;
/** Don't slurp absurdly large transcripts whole; read at most this many bytes. */
const MAX_FILE_BYTES = 64 * 1024 * 1024;
/** Cap on subagent files scanned, to bound a runaway dispatch dir. */
const MAX_SUBAGENTS = 200;
/** Bytes to scan from each subagent file when building its lightweight summary. */
const SUBAGENT_SCAN_BYTES = 4 * 1024 * 1024;

// ---- raw line shape --------------------------------------------------------

interface RawLine {
  type?: string;
  timestamp?: string;
  sessionId?: string;
  uuid?: string;
  parentUuid?: string | null;
  isSidechain?: boolean;
  cwd?: string;
  gitBranch?: string;
  level?: string;
  subtype?: string;
  isApiErrorMessage?: boolean;
  content?: unknown;
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
}

interface ContentBlock {
  type?: string;
  text?: unknown;
  name?: string;
  input?: Record<string, unknown>;
  content?: unknown;
}

// ---- small helpers ---------------------------------------------------------

function tsMs(line: RawLine): number {
  const t = line.timestamp ? Date.parse(line.timestamp) : NaN;
  return Number.isNaN(t) ? 0 : t;
}

function usageOf(line: RawLine): TokenCounts | undefined {
  const u = line.message?.usage;
  if (!u) return undefined;
  return {
    input: u.input_tokens ?? 0,
    output: u.output_tokens ?? 0,
    cacheWrite: u.cache_creation_input_tokens ?? 0,
    cacheRead: u.cache_read_input_tokens ?? 0
  };
}

function addTokensInto(into: TokenCounts, add: TokenCounts): void {
  into.input += add.input;
  into.output += add.output;
  into.cacheWrite += add.cacheWrite;
  into.cacheRead += add.cacheRead;
}

/** Flatten message.content (string | block[]) to plain text, incl. tool_result bodies. */
function blocksText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const raw of content) {
    if (!raw || typeof raw !== 'object') continue;
    const b = raw as ContentBlock;
    if (b.type === 'text' && typeof b.text === 'string') parts.push(b.text);
    else if (b.type === 'tool_result') parts.push(blocksText(b.content));
  }
  return parts.join('\n');
}

function hasToolResult(content: unknown): boolean {
  return (
    Array.isArray(content) &&
    content.some((b) => b && typeof b === 'object' && (b as ContentBlock).type === 'tool_result')
  );
}

const FILE_TOOLS: Record<string, string> = {
  Edit: 'edit',
  Write: 'write',
  MultiEdit: 'multiedit',
  NotebookEdit: 'notebook'
};

function toolFilePath(input: Record<string, unknown> | undefined): string | undefined {
  const fp = (input?.file_path ?? input?.notebook_path ?? input?.path) as unknown;
  return typeof fp === 'string' && fp ? fp : undefined;
}

/** Concise, human-readable summary of a tool_use input (already truncated). */
function summarizeToolInput(name: string, input: Record<string, unknown> | undefined): string {
  const file = toolFilePath(input);
  const fileName = file ? basename(file) : undefined;
  switch (name) {
    case 'Edit':
    case 'MultiEdit':
    case 'Write':
    case 'NotebookEdit':
      return fileName ?? 'a file';
    case 'Read':
      return fileName ?? 'a file';
    case 'Bash': {
      const desc = (input?.description ?? input?.command) as string | undefined;
      return desc ? truncate(desc, 80) : 'a command';
    }
    case 'Grep':
      return input?.pattern ? truncate(String(input.pattern), 60) : 'search';
    case 'Glob':
      return input?.pattern ? truncate(String(input.pattern), 60) : 'glob';
    case 'Task': {
      const sub = input?.subagent_type ? String(input.subagent_type) : 'agent';
      const desc = input?.description ? `: ${String(input.description)}` : '';
      return truncate(`${sub}${desc}`, 80);
    }
    case 'TodoWrite': {
      const todos = input?.todos;
      const n = Array.isArray(todos) ? todos.length : 0;
      return n ? `${n} todo${n === 1 ? '' : 's'}` : 'todos';
    }
    case 'WebFetch':
      return input?.url ? truncate(String(input.url), 70) : 'a page';
    case 'WebSearch':
      return input?.query ? truncate(String(input.query), 70) : 'the web';
    default: {
      // Best-effort: first stringish field, else compact JSON.
      if (input) {
        for (const v of Object.values(input)) {
          if (typeof v === 'string' && v.trim()) return truncate(v, 70);
        }
        try {
          return truncate(JSON.stringify(input), 70);
        } catch {
          /* ignore */
        }
      }
      return '';
    }
  }
}

function extractToolUses(content: unknown): ToolUseSummary[] {
  if (!Array.isArray(content)) return [];
  const out: ToolUseSummary[] = [];
  for (const raw of content) {
    if (!raw || typeof raw !== 'object') continue;
    const b = raw as ContentBlock;
    if (b.type === 'tool_use' && typeof b.name === 'string') {
      out.push({
        name: b.name,
        inputSummary: summarizeToolInput(b.name, b.input),
        filePath: toolFilePath(b.input)
      });
    }
  }
  return out;
}

// ---- file reading (fail-soft, bounded) -------------------------------------

/** Read up to `maxBytes` of a file as utf8; returns '' on any error. */
function readBounded(path: string, maxBytes: number): string {
  try {
    const size = statSync(path).size;
    const len = Math.min(size, maxBytes);
    if (len <= 0) return '';
    const buf = Buffer.alloc(len);
    const fd = openSync(path, 'r');
    try {
      readSync(fd, buf, 0, len, 0);
    } finally {
      closeSync(fd);
    }
    return buf.toString('utf8');
  } catch {
    return '';
  }
}

/** Parse a JSONL blob into raw line objects, fail-soft, capped at `maxLines`. */
function parseJsonl(text: string, maxLines: number): { lines: RawLine[]; total: number } {
  const lines: RawLine[] = [];
  let total = 0;
  for (const part of text.split('\n')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    total++;
    if (lines.length >= maxLines) continue; // keep counting, stop collecting
    try {
      lines.push(JSON.parse(trimmed) as RawLine);
    } catch {
      // Skip a single malformed line; never crash the parse.
    }
  }
  return { lines, total };
}

// ---- locate the session file -----------------------------------------------

interface Located {
  filePath: string;
  /** projects/<enc> — the directory containing the transcript file. */
  projectDir: string;
  /** projects/<enc>/<sessionId> — where this session's subagents live. */
  childDir: string;
}

function locate(sessionId: string): Located | null {
  if (!sessionId || sessionId.includes('/') || sessionId.includes('\\') || sessionId.includes('..')) {
    return null; // defensive: never traverse outside projects/
  }
  const root = projectsDir();
  let dirs: string[];
  try {
    dirs = readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => join(root, d.name));
  } catch {
    return null;
  }
  for (const dir of dirs) {
    const filePath = join(dir, `${sessionId}.jsonl`);
    if (existsSync(filePath)) {
      return { filePath, projectDir: dir, childDir: join(dir, sessionId) };
    }
  }
  return null;
}

// ---- subagent tree ---------------------------------------------------------

/** Recursively collect *.jsonl paths under a directory (bounded). */
function collectJsonl(dir: string, acc: string[], limit: number): void {
  if (acc.length >= limit || !existsSync(dir)) return;
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) {
    if (acc.length >= limit) return;
    const p = join(dir, name);
    try {
      if (statSync(p).isDirectory()) collectJsonl(p, acc, limit);
      else if (name.endsWith('.jsonl')) acc.push(p);
    } catch {
      /* skip unreadable entry */
    }
  }
}

/** Build a lightweight node for one subagent transcript file. */
function summarizeSubagent(path: string): SubagentNode | null {
  const text = readBounded(path, SUBAGENT_SCAN_BYTES);
  if (!text) return null;
  const { lines } = parseJsonl(text, MAX_LINES);
  if (lines.length === 0) return null;

  let title = '';
  let model = '';
  const tokens: TokenCounts = { ...EMPTY_TOKENS };
  let startedAt = 0;
  let lastActivityAt = 0;

  for (const line of lines) {
    const t = tsMs(line);
    if (t) {
      if (startedAt === 0 || t < startedAt) startedAt = t;
      if (t > lastActivityAt) lastActivityAt = t;
    }
    if (line.type === 'user' && !title && !hasToolResult(line.message?.content)) {
      const txt = blocksText(line.message?.content);
      if (txt.trim()) title = truncate(txt, 90);
    }
    if (line.type === 'assistant') {
      if (typeof line.message?.model === 'string' && line.message.model) model = line.message.model;
      const u = usageOf(line);
      if (u) addTokensInto(tokens, u);
    }
  }

  const { costUsd, estimated } = computeCost(model, tokens);
  const id = basename(path, '.jsonl').replace(/^agent-/, '');
  return {
    id,
    title: title || id,
    model: model || 'unknown',
    tokens,
    costUsd,
    estimated,
    startedAt,
    lastActivityAt,
    eventCount: lines.length,
    filePath: path,
    children: []
  };
}

function buildSubagents(childDir: string): SubagentNode[] {
  const files: string[] = [];
  collectJsonl(join(childDir, 'subagents'), files, MAX_SUBAGENTS);
  collectJsonl(join(childDir, 'workflows'), files, MAX_SUBAGENTS);
  const nodes: SubagentNode[] = [];
  for (const f of files) {
    const node = summarizeSubagent(f);
    if (node) nodes.push(node);
  }
  nodes.sort((a, b) => a.startedAt - b.startedAt);
  return nodes;
}

// ---- main builder ----------------------------------------------------------

function emptyDetail(sessionId: string, notFound: boolean): TranscriptDetail {
  return {
    sessionId,
    title: sessionId.slice(0, 8),
    model: 'unknown',
    project: 'unknown',
    cwd: '',
    startedAt: 0,
    lastActivityAt: 0,
    tokens: { ...EMPTY_TOKENS },
    costUsd: 0,
    costBreakdown: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 },
    estimated: false,
    events: [],
    filesTouched: [],
    subagents: [],
    truncated: false,
    totalEvents: 0,
    fetchedAt: Date.now(),
    notFound
  };
}

function costBreakdownFor(model: string, tokens: TokenCounts): CostBreakdown {
  // Reuse the shared pricing model by costing one bucket at a time.
  const zero = { ...EMPTY_TOKENS };
  return {
    input: computeCost(model, { ...zero, input: tokens.input }).costUsd,
    output: computeCost(model, { ...zero, output: tokens.output }).costUsd,
    cacheWrite: computeCost(model, { ...zero, cacheWrite: tokens.cacheWrite }).costUsd,
    cacheRead: computeCost(model, { ...zero, cacheRead: tokens.cacheRead }).costUsd
  };
}

/**
 * Fetch one session's full transcript detail. Always returns a value
 * (fail-soft); `notFound` flags a missing file rather than throwing.
 */
export function getTranscriptDetail(sessionId: string): TranscriptDetail {
  const found = locate(sessionId);
  if (!found) return emptyDetail(sessionId, true);

  const text = readBounded(found.filePath, MAX_FILE_BYTES);
  if (!text) return emptyDetail(sessionId, false);

  const { lines } = parseJsonl(text, MAX_LINES);

  const events: TranscriptEvent[] = [];
  // Count of renderable events (user/assistant/system/tool) seen, even past the
  // MAX_EVENTS cap — drives the accurate "showing N of M" / truncation flag.
  let renderable = 0;
  const tokens: TokenCounts = { ...EMPTY_TOKENS };
  const fileMap = new Map<string, FileTouched>();
  let title = '';
  let model = '';
  let cwd = '';
  let project = '';
  let gitBranch: string | undefined;
  let startedAt = 0;
  let lastActivityAt = 0;

  for (const line of lines) {
    const t = tsMs(line);
    if (t) {
      if (startedAt === 0 || t < startedAt) startedAt = t;
      if (t > lastActivityAt) lastActivityAt = t;
    }
    if (typeof line.cwd === 'string' && line.cwd) {
      cwd = line.cwd;
      project = basename(line.cwd);
    }
    if (typeof line.gitBranch === 'string' && line.gitBranch) gitBranch = line.gitBranch;

    const isSidechain = line.isSidechain === true;
    const content = line.message?.content ?? line.content;

    let kind: TranscriptEventKind;
    if (line.type === 'assistant') kind = 'assistant';
    else if (line.type === 'system') kind = 'system';
    else if (line.type === 'user') kind = hasToolResult(content) ? 'tool' : 'user';
    else continue; // summary / unknown meta lines are not rendered
    renderable++;

    // Folded totals (from ALL lines, even past the event cap).
    if (kind === 'assistant') {
      if (typeof line.message?.model === 'string' && line.message.model) model = line.message.model;
      const u = usageOf(line);
      if (u) addTokensInto(tokens, u);
      // Files touched.
      if (Array.isArray(content)) {
        for (const raw of content) {
          if (!raw || typeof raw !== 'object') continue;
          const b = raw as ContentBlock;
          if (b.type !== 'tool_use' || typeof b.name !== 'string') continue;
          const op = FILE_TOOLS[b.name];
          if (!op) continue;
          const fp = toolFilePath(b.input);
          if (!fp) continue;
          const existing = fileMap.get(fp);
          if (existing) existing.count++;
          else fileMap.set(fp, { path: fp, name: basename(fp), op, count: 1 });
        }
      }
    }
    if (kind === 'user' && !title) {
      const txt = blocksText(content);
      if (txt.trim()) title = truncate(txt, 90);
    }

    if (events.length >= MAX_EVENTS) continue; // keep tallying, stop collecting

    if (kind === 'assistant') {
      const md = blocksText(content);
      const toolUses = extractToolUses(content);
      events.push({
        kind,
        timestamp: t,
        uuid: line.uuid,
        parentUuid: typeof line.parentUuid === 'string' ? line.parentUuid : undefined,
        isSidechain,
        markdown: md.trim() ? md : undefined,
        toolUses: toolUses.length ? toolUses : undefined,
        usage: usageOf(line),
        model: typeof line.message?.model === 'string' ? line.message.model : undefined
      });
    } else {
      const txt = blocksText(content).trim();
      events.push({
        kind,
        timestamp: t,
        uuid: line.uuid,
        parentUuid: typeof line.parentUuid === 'string' ? line.parentUuid : undefined,
        isSidechain,
        text: txt || undefined
      });
    }
  }

  const usedModel = model || 'unknown';
  const { costUsd, estimated } = computeCost(usedModel, tokens);
  const filesTouched = [...fileMap.values()].sort((a, b) => b.count - a.count);
  const subagents = buildSubagents(found.childDir);

  return {
    sessionId,
    title: title || project || sessionId.slice(0, 8),
    model: usedModel,
    project: project || basename(found.projectDir),
    cwd,
    gitBranch,
    startedAt,
    lastActivityAt,
    tokens,
    costUsd,
    costBreakdown: costBreakdownFor(usedModel, tokens),
    estimated,
    events,
    filesTouched,
    subagents,
    truncated: renderable > events.length,
    totalEvents: renderable,
    fetchedAt: Date.now(),
    notFound: false
  };
}
