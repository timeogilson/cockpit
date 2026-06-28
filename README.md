# Cockpit

A local **Electron desktop app to observe (and later control) Claude Code agents** —
a live agents board, a usage/cost rail, and (in later slices) transcript viewing,
history search, launch/stop/follow-up control, and alerts.

Cockpit reads your real Claude Code data **read-only** from `~/.claude` and shows
what every agent is doing right now, what each session has cost, and where your
spend is going today.

> Status: **M0 (skeleton) + a thin vertical slice of M1 (live agents board)**.
> See [`docs/superpowers/specs/2026-06-28-cockpit-design.md`](docs/superpowers/specs/2026-06-28-cockpit-design.md)
> for the full architecture and the M0→M7 slice plan.

---

## What works today

- **Electron shell** — single dark window + **system tray** (Show / Quit, live
  "N busy" tooltip, click to focus). Stays alive in the tray when the window closes.
- **Typed IPC bridge** — `window.cockpit.subscribe(channel, cb)` for pushed streams
  and `window.cockpit.invoke(command, payload)` for request/response, fully typed
  end-to-end from `src/shared`. `contextIsolation: true`, `nodeIntegration: false`.
- **DataEngine** (Node main process, read-only):
  - **RosterParser** → `daemon/roster.json` for currently-active sessions.
  - **Transcript tail** → reads the ~40 most-recent sessions by mtime, parsing only
    newly-appended bytes (per-file byte-offset checkpoints), skipping bad JSONL lines.
  - **SessionAggregator** → folds events into one Agent per session (title, model,
    project, branch, tokens, cost, live activity line).
  - **Liveness state machine** → `busy · idle · needs-input · done · failed`
    fused from roster presence + transcript recency + marker lines
    (`result:` / `needs input:` / `failed:`).
  - **CostCalculator** → token counts × an editable pricing table
    (`src/shared/pricing.ts`); unknown models flagged as estimated.
  - **Watcher** → `chokidar` on roster/sessions/transcripts + a 4s poll fallback,
    debounced, pushing `agents:update` / `usage:update` snapshots.
- **Agents board** — Kanban lanes (Running · Needs input · Done · Failed · Idle)
  with live cards (title, model chip, elapsed/last-activity, project + branch,
  activity line, token/cost) and tasteful empty states.
- **Usage rail** — today's spend, token totals (in/out/cache), and a per-model
  breakdown.

Not yet built (later slices): charts & rolling windows (M2), transcript viewer &
search (M3), launch/stop/follow-up control (M4), subagent tree & projects (M5),
notifications (M6), config/plugins browsers (M7).

---

## Prerequisites

- **Node.js ≥ 20** (developed on Node 24).
- Windows / macOS / Linux. Reads `~/.claude` (or `CLAUDE_CONFIG_DIR` if set).
- Having used Claude Code locally (so there is data to show) — otherwise the board
  is simply empty, which is a valid state.

## Install

```bash
npm install
```

## Run it on screen (development)

```bash
npm run dev
```

This launches the app with hot-reload. You should see the dark shell with the
Agents board populated from your real `~/.claude` sessions and the Usage rail on
the right, plus a tray icon.

## Other scripts

```bash
npm run build       # electron-vite production build → out/
npm run start       # preview the built app (electron-vite preview)
npm run typecheck   # tsc --noEmit across the node + web tsconfigs
```

> Packaging (electron-builder) is configured in `electron-builder.yml` but **not**
> wired to a script yet — no installer is produced in this slice.

---

## Project structure

```
cockpit/
  src/
    shared/                # domain model + IPC contract + pricing (imported by all sides)
      types.ts  ipc.ts  pricing.ts
    main/                  # Node main process
      index.ts             # app bootstrap, window, lifecycle
      tray.ts  trayIcon.ts # system tray (embedded icon)
      ipc.ts               # engine ↔ typed IPC wiring + push
      engine/              # the DataEngine (UI-agnostic)
        DataEngine.ts      # scan / tail / watch / aggregate / emit
        roster.ts          # RosterParser + pid liveness
        transcript.ts      # SessionAggregator fold logic
        liveness.ts        # status state machine + marker scan
        paths.ts           # ~/.claude path resolution
    preload/
      index.ts             # locked-down contextBridge → window.cockpit
    renderer/              # React + Tailwind UI
      App.tsx  main.tsx  index.html  styles.css
      store/useStore.ts    # Zustand store fed by IPC
      components/          # TopNav, AgentsBoard, Lane, AgentCard, UsageRail, Placeholder
      lib/                 # formatting + live-clock helpers
  electron.vite.config.ts
  tailwind.config.js  postcss.config.js
  tsconfig*.json
  electron-builder.yml     # packaging config (future)
  resources/               # tray/app icon PNGs
```

---

## Safety & data handling

- All `~/.claude` access is **read-only**. Cockpit never writes to your Claude data
  in this slice and does not read `settings.json` (which holds env secrets).
- The engine is **fail-soft**: missing roster, malformed JSONL lines, or unknown
  models degrade gracefully and are logged, never crashing the main process.
- Pricing in `src/shared/pricing.ts` is an **editable estimate** — adjust to taste.
