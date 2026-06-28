# Cockpit — Design Spec

> A local Electron desktop app to observe **and** control Claude Code agents:
> a live agents board, a usage/cost rail, transcript viewing, history search,
> launch/stop/follow-up control, and active alerts when agents finish or need you.
>
> Date: 2026-06-28 · Owner: Timéo · Status: approved, building

---

## 0. Goals & decisions

| Decision | Choice |
|---|---|
| Form factor | **Desktop app — Electron** (window + system tray + native notifications) |
| Scope | **Observe + control** (read `~/.claude`, and spawn/kill/resume `claude`) |
| Ambition | **Big** — full feature set, built in shippable slices |
| Stack | **Electron + React + Vite + TypeScript + Tailwind**; Zustand state; Recharts; better-sqlite3 cache; chokidar watcher; Vitest |
| Name | **Cockpit** |
| Repo | standalone git repo at `~/cockpit/` (GitHub remote created during build) |
| Later | multi-machine aggregation · Codex adapter · mini-widget · auto-start/hotkey |

**Non-negotiables:** all `~/.claude` access is **read-only** except explicit settings
writes (which back up first). The engine is **fail-soft**: one bad JSONL line is
skipped and logged, never crashes a stream.

---

## 1. What Claude Code exposes locally (the data layer)

Confirmed by inspection of `C:\Users\Timéo\.claude\`:

| Signal | Source | Notes |
|---|---|---|
| **Active agents** | `daemon/roster.json` → `workers{}` | `{pid, sessionId, cwd, startedAt, cliVersion, dispatch}`; primary liveness |
| Per-pid status | `sessions/<pid>.json` | `{pid, sessionId, status:"busy", startedAt, updatedAt}` |
| **Transcripts** | `projects/<enc-path>/<uuid>.jsonl` | streamed events; per-assistant `message.usage`, `message.model`, `tool_use`, `timestamp`, `uuid`, `parentUuid`, `isSidechain`, `cwd`, `gitBranch` |
| Subagents | `projects/.../subagents/<id>.jsonl`, `.../workflows/<wf>/agent-<id>.jsonl` | tree via `parentUuid` + `isSidechain` |
| Background jobs | `jobs/<uuid>/...` | no reliable per-job status file — derive from roster + transcript |
| Config | `settings.json`, `settings.local.json` | model, permissions, effort, env (⚠ secrets), enabled plugins, hooks |
| Plugins/skills | `plugins/`, `skills/` | installed/enabled |
| Shell activity | `shell-snapshots/*.sh` | timestamped snapshots |
| File edits | `file-history/` | per-session edit snapshots |

**No local cost/usage cache exists** — cost is **derived** from token counts × a
pricing table. **No explicit status flag** — `needs-input`/`done`/`failed` are
**derived** (see §4).

Models seen: `claude-opus-4-8`, `claude-3.5-sonnet`, etc. Pricing table is local,
editable, with defaults; unknown model → cost flagged `est.`, never a crash.

Codex (later): `C:\Users\Timéo\.codex\` — different schema (`session_index.jsonl`,
SQLite `logs/state/goals/memories`, `config.toml`). A separate adapter, same engine.

---

## 2. Process model

- **Main process (Node)** — hosts the *Data Engine*, the *Controller*, tray,
  native notifications, windows.
- **Renderer (React/Vite)** — the dashboard. Communicates over **typed IPC**
  through a locked-down preload bridge: `contextIsolation: true`,
  `nodeIntegration: false`, `sandbox` where possible.
- **`@cockpit/types`** — shared TS package: domain model + IPC contract, imported
  by both sides so the wire is type-checked end to end.

```
~/.claude files ──▶ Watcher ──▶ Parsers ──▶ Aggregator/Store ──▶ diff
                                                                   │ IPC push
                                                                   ▼
                                                            Renderer store ──▶ UI
   spawn/kill claude ◀── Controller ◀── IPC invoke ◀────────────── UI actions
```

---

## 3. The Data Engine (UI-agnostic — the heart)

A standalone TS module in main. All Claude-specific knowledge lives here so the UI
stays dumb and a **Codex adapter later is just another source** feeding the same model.

- **Watcher** — `chokidar` + a 3–5s poll loop. Watches `daemon/roster.json`,
  `sessions/*.json`, `projects/**/*.jsonl`, `jobs/**`, config files. Debounced.
- **Parsers**
  - *RosterParser* → live workers.
  - *TranscriptParser* → **incremental tail**: stores a byte-offset per file and
    reads only newly appended bytes (never re-parses a whole transcript). Emits
    normalized events; extracts usage/model/tool_use/timestamps/isSidechain/parentUuid;
    scans assistant text for **marker lines** `result:` / `needs input:` / `failed:`.
  - *SessionAggregator* → folds events into a `Session` (status, models, tokens,
    cost, last activity, files touched, tool calls, subagent tree).
  - *CostCalculator* → tokens × pricing table; handles cache-read vs cache-write
    rates; unknown model → `est.` flag.
  - *UsageRoller* → today, **5h rolling window**, weekly window, per-model,
    per-project, burn rate, projection.
- **Store/index** — in-memory normalized model `{agents, sessions, projects, usage}`,
  backed by an incremental on-disk cache (`better-sqlite3`) keyed by transcript
  byte-offset checkpoints, so all-time stats/history don't re-scan on launch.

### Domain model (sketch)
```ts
type AgentStatus = 'busy' | 'idle' | 'needs-input' | 'done' | 'failed';
interface Agent {
  sessionId: string; pid?: number; title: string; status: AgentStatus;
  model: string; project: string; cwd: string; gitBranch?: string;
  startedAt: number; lastActivityAt: number;
  tokens: TokenCounts; costUsd: number; estimated: boolean;
  activityLine?: string;           // "editing auth.ts" / last tool call
  subagents: Agent[];              // from parentUuid/isSidechain
  isBackgroundJob?: boolean;
}
interface Usage { today: Money; window5h: WindowStat; week: WindowStat;
  byModel: Record<string, Money>; byProject: Record<string, Money>;
  burnRatePerHour: number; projectedDay: number; projectedMonth: number;
  cacheEfficiency: number; }
```

---

## 4. Liveness state machine (the trickiest part)

Claude Code has no single status field, so status is **fused** from three weak signals:

1. **roster worker present** + PID alive (`process.kill(pid,0)` / `tasklist`)
2. **transcript recency** (time since last event)
3. **marker lines** in the latest assistant text

| Conditions | Status |
|---|---|
| worker alive, event < ~20s ago | `busy` |
| worker alive, quiet > threshold | `idle` |
| latest marker `needs input:` and no live worker | `needs-input` |
| no worker, latest marker `result:` or clean end | `done` |
| no worker, marker `failed:` or error event | `failed` |

This state machine is the **#1 thing pinned down by fixture tests** (§7).

---

## 5. The Controller (the control half)

- **Launch** — `spawn('claude', [...], {cwd})` from a launch form (project, prompt,
  model, effort, background y/n). Track child PID; exact CLI flags confirmed during
  implementation.
- **Stop/kill** — by PID; Windows tree-kill via `taskkill /PID <pid> /T /F`.
- **Follow-up / re-run** — `claude --resume <sessionId> -p "<msg>"`. Follow-ups on
  Cockpit-launched agents are first-class (we own stdin); injecting into a *live
  external* session is best-effort/later.
- **Multi-agent dispatch** — fire N agents over a task list, each its own cwd/worktree,
  all visible in the lanes.
- **Templates** — saved prompt presets in Cockpit config.
- **Permission prompts** — surface and answer waiting permission prompts (later slice).

---

## 6. Renderer / UI

- **Layout** — top nav (Agents · Sessions · Projects · Usage · Config) + global
  search; **main = Agents board**, **right rail = Usage**. Claude-style **dark theme**
  (Tailwind tokens matching the Synapse/timeogilson aesthetic).
- **Agents board** — Kanban lanes (Running · Needs input · Done · Failed · Idle) of
  cards: task title, model chip, elapsed timer, project + branch, **live activity
  line**, token/cost meter, subagent count. Click → drawer.
- **Detail drawer / transcript viewer** — rendered markdown, collapsible tool calls,
  diffs, files touched, **subagent tree**, cost breakdown, timeline; actions: stop ·
  follow-up · resume · open in editor/terminal · export.
- **Usage** — today's spend, 5h + weekly bars, per-model donut, per-project bars,
  **cost-over-time chart**, cache efficiency, burn rate + projection, budget threshold,
  most-expensive leaderboard, **activity heatmap**.
- **Sessions/History** — searchable/filterable table; full-text transcript search;
  resume/export.
- **Projects** — per-project cost/sessions/last-activity + git branch/dirty; open in
  editor/terminal/explorer; worktrees view.
- **Config** — settings viewer/editor (backs up before writing); plugins/skills/MCP/
  hooks/memory browsers.
- **State** — Zustand store fed by IPC subscriptions; charts via Recharts.

---

## 7. Errors, alerts, testing

- **Fail-soft engine** — bad JSONL line skipped + logged; missing roster = "no active
  agents"; unknown model = estimated cost; control errors surface as toasts.
- **Alerts** — main fires **native notifications** on finish / fail / **needs-input** /
  budget-crossed; **tray icon** shows live busy count; clicking a notification focuses
  that agent.
- **Testing** — Data Engine is pure-ish TS → **Vitest** unit tests over **fixture
  transcripts** (sample roster + JSONL) asserting normalized model, cost math, and the
  liveness state machine. Light component tests on UI; live board manually verified.

---

## 8. Config & persistence

Cockpit's own data in `%APPDATA%/Cockpit/`: pricing table, budget thresholds, prompt
templates, window prefs, transcript byte-offset checkpoints, optional SQLite history index.

---

## 9. Build slices (each ships a usable app)

- **M0 — Skeleton.** Electron + Vite + React + Tailwind boots; window + tray; typed IPC
  bridge; dark shell; repo + CI + README.
- **M1 — Live Agents board (read-only).** Watcher + roster + transcript tail + aggregator
  → lanes with live cards, activity line, per-agent cost. *First "wow"; already the
  thing originally asked for.*
- **M2 — Usage rail + charts.** Cost calc + roller → today/5h/week, per-model, per-project,
  cost-over-time, cache efficiency, burn rate.
- **M3 — Transcript viewer + history/search.** Detail drawer, sessions table, full-text
  search, resume/export.
- **M4 — Control.** Launch / stop / follow-up / re-run / multi-agent dispatch / templates.
- **M5 — Subagent tree + projects + git.**
- **M6 — Notifications + needs-input/budget alerts + tray polish.**
- **M7 — Config / plugins / skills / MCP / hooks / memory browser.**
- **Later** — multi-machine · Codex adapter · mini-widget · auto-start/hotkey · activity heatmap polish.

> Selected for v1 scope: **everything above** (all clusters A–G + wow features), built
> in the M0→M7 order. M0+M1 are the first on-screen deliverable to iterate from.

---

## 10. Full feature checklist (from brainstorm — all selected)

**Agents (A):** cards · status lanes · live activity line · stuck detector ·
subagent/workflow tree · per-agent token+cost meter · detail drawer · background-job lane.
**Usage (B):** today spend · 5h+weekly windows · cost-over-time · per-model · per-project ·
cache efficiency · burn rate/projection · budget alerts · most-expensive leaderboard.
**Sessions (C):** history · full-text search · transcript viewer · filters · resume ·
export · activity heatmap · all-time stats.
**Control (D):** launch · stop/kill · follow-up · re-run/resume · templates ·
multi-agent dispatch · approve/deny permissions.
**Projects (E):** per-project dashboard · open in editor/terminal/explorer · git status ·
worktrees.
**Config (F):** settings editor · plugins/skills browser · MCP status · hooks viewer ·
memory/CLAUDE.md editor.
**Polish (G):** tray w/ live status · native notifications · dark theme · mini-widget ·
auto-start + hotkey · multi-machine later · Codex adapter later.
