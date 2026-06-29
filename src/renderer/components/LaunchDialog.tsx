import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Plus, X } from 'lucide-react';
import {
  EFFORT_LEVELS,
  MODEL_CHOICES,
  type EffortLevel,
  type LaunchRequest,
  type PromptTemplate
} from '@shared/control';
import { useStore } from '../store/useStore';
import { useControlStore } from '../store/useControlStore';

type Mode = 'single' | 'multi';

interface MultiRow {
  cwd: string;
  prompt: string;
}

export default function LaunchDialog(): JSX.Element | null {
  const open = useControlStore((s) => s.launchOpen);
  const close = useControlStore((s) => s.closeLaunch);
  const launch = useControlStore((s) => s.launch);
  const dispatch = useControlStore((s) => s.dispatch);
  const agents = useStore((s) => s.agents);

  const recentCwds = useMemo(() => {
    const seen = new Set<string>();
    const out: { cwd: string; project: string }[] = [];
    for (const a of agents?.agents ?? []) {
      if (a.cwd && !seen.has(a.cwd)) {
        seen.add(a.cwd);
        out.push({ cwd: a.cwd, project: a.project });
      }
    }
    return out;
  }, [agents]);

  const [mode, setMode] = useState<Mode>('single');
  const [cwd, setCwd] = useState('');
  const [prompt, setPrompt] = useState('');
  const [model, setModel] = useState('');
  const [effort, setEffort] = useState<EffortLevel | ''>('');
  const [background, setBackground] = useState(false);
  const [busy, setBusy] = useState(false);

  const [templates, setTemplates] = useState<PromptTemplate[]>([]);
  const [savingName, setSavingName] = useState<string | null>(null);

  const [rows, setRows] = useState<MultiRow[]>([{ cwd: '', prompt: '' }]);

  // Default the cwd to the most recent project when opening.
  useEffect(() => {
    if (!open) return;
    setCwd((c) => c || recentCwds[0]?.cwd || '');
    void refreshTemplates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function refreshTemplates(): Promise<void> {
    try {
      const res = await window.cockpit.invoke('control:templates:list');
      setTemplates(res.templates);
    } catch {
      /* fail-soft: leave templates empty */
    }
  }

  if (!open) return null;

  function applyTemplate(id: string): void {
    const t = templates.find((x) => x.id === id);
    if (!t) return;
    setPrompt(t.prompt);
    if (t.model !== undefined) setModel(t.model ?? '');
    if (t.effort !== undefined) setEffort(t.effort ?? '');
    if (t.background !== undefined) setBackground(!!t.background);
  }

  async function saveTemplate(): Promise<void> {
    const name = (savingName ?? '').trim();
    if (!name || !prompt.trim()) return;
    try {
      const res = await window.cockpit.invoke('control:templates:save', {
        name,
        prompt,
        model: model || undefined,
        effort: effort || undefined,
        background
      });
      setTemplates(res.templates);
      setSavingName(null);
    } catch {
      /* fail-soft */
    }
  }

  function reset(): void {
    setPrompt('');
    setModel('');
    setEffort('');
    setBackground(false);
    setRows([{ cwd: '', prompt: '' }]);
    setSavingName(null);
  }

  async function onLaunch(): Promise<void> {
    if (!cwd.trim() || !prompt.trim()) return;
    setBusy(true);
    const req: LaunchRequest = {
      cwd: cwd.trim(),
      prompt: prompt.trim(),
      model: model || undefined,
      effort: effort || undefined,
      background
    };
    const ok = await launch(req);
    setBusy(false);
    if (ok) {
      reset();
      close();
    }
  }

  async function onDispatch(): Promise<void> {
    const tasks = rows
      .map((r) => ({ cwd: r.cwd.trim(), prompt: r.prompt.trim() }))
      .filter((r) => r.cwd && r.prompt)
      .map((r) => ({ ...r, model: model || undefined, effort: effort || undefined, background }));
    if (tasks.length === 0) return;
    setBusy(true);
    const ok = await dispatch({ tasks });
    setBusy(false);
    if (ok) {
      reset();
      close();
    }
  }

  const canLaunch = cwd.trim().length > 0 && prompt.trim().length > 0 && !busy;
  const canDispatch = rows.some((r) => r.cwd.trim() && r.prompt.trim()) && !busy;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-6 backdrop-blur-[2px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="flex max-h-[86vh] w-[640px] max-w-full flex-col overflow-hidden rounded-lg border border-ink-700 bg-ink-900 shadow-float">
        <header className="flex items-center justify-between border-b border-ink-800 px-5 py-3.5">
          <div className="flex items-center gap-3">
            <h2 className="text-[14px] font-semibold text-ink-100/95">Launch agent</h2>
            <div className="flex items-center gap-1 rounded-md bg-ink-850 p-0.5">
              {(['single', 'multi'] as Mode[]).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={[
                    'cursor-pointer rounded px-2.5 py-1 text-[11.5px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent-ring',
                    mode === m ? 'bg-accent-soft text-ink-50' : 'text-ink-500 hover:text-ink-100'
                  ].join(' ')}
                >
                  {m === 'single' ? 'Single' : 'Multi-dispatch'}
                </button>
              ))}
            </div>
          </div>
          <button
            onClick={close}
            aria-label="Close"
            className="grid h-7 w-7 cursor-pointer place-items-center rounded-md text-ink-500 outline-none transition-colors hover:bg-ink-800 hover:text-ink-100/80 focus-visible:ring-2 focus-visible:ring-accent-ring"
          >
            <X size={16} strokeWidth={1.75} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {mode === 'single' ? (
            <div className="space-y-4">
              <Field label="Project / working directory">
                <input
                  list="cockpit-cwds"
                  value={cwd}
                  onChange={(e) => setCwd(e.target.value)}
                  placeholder="C:\path\to\project"
                  className={inputCls}
                />
                <datalist id="cockpit-cwds">
                  {recentCwds.map((r) => (
                    <option key={r.cwd} value={r.cwd}>
                      {r.project}
                    </option>
                  ))}
                </datalist>
              </Field>

              {templates.length > 0 && (
                <Field label="Template">
                  <select
                    defaultValue=""
                    onChange={(e) => {
                      applyTemplate(e.target.value);
                      e.currentTarget.value = '';
                    }}
                    className={inputCls}
                  >
                    <option value="" disabled>
                      Apply a saved preset…
                    </option>
                    {templates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </Field>
              )}

              <Field label="Prompt">
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  rows={6}
                  placeholder="Describe the task for the agent…"
                  className={`${inputCls} resize-y font-mono text-[12px] leading-relaxed`}
                />
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Model">
                  <select value={model} onChange={(e) => setModel(e.target.value)} className={inputCls}>
                    <option value="">Default</option>
                    {MODEL_CHOICES.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Effort">
                  <select
                    value={effort}
                    onChange={(e) => setEffort(e.target.value as EffortLevel | '')}
                    className={inputCls}
                  >
                    <option value="">Default</option>
                    {EFFORT_LEVELS.map((lvl) => (
                      <option key={lvl} value={lvl}>
                        {lvl}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>

              <label className="flex items-center gap-2 text-[12.5px] text-ink-100/80">
                <input
                  type="checkbox"
                  checked={background}
                  onChange={(e) => setBackground(e.target.checked)}
                  className="h-3.5 w-3.5 accent-accent"
                />
                Run as background agent (<code className="text-ink-500">--background</code>)
              </label>

              <div className="flex items-center gap-2 border-t border-ink-800 pt-3">
                {savingName === null ? (
                  <button
                    onClick={() => setSavingName('')}
                    disabled={!prompt.trim()}
                    className="cursor-pointer rounded-md border border-ink-700 bg-ink-850 px-2.5 py-1.5 text-[11.5px] text-ink-100/75 outline-none transition-colors hover:border-ink-600 hover:bg-ink-800 focus-visible:ring-2 focus-visible:ring-accent-ring disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Save as template
                  </button>
                ) : (
                  <div className="flex flex-1 items-center gap-2">
                    <input
                      autoFocus
                      value={savingName}
                      onChange={(e) => setSavingName(e.target.value)}
                      placeholder="Template name"
                      className={`${inputCls} flex-1`}
                    />
                    <button
                      onClick={saveTemplate}
                      disabled={!savingName.trim()}
                      className="cursor-pointer rounded-md border border-ink-700 bg-ink-850 px-2.5 py-1.5 text-[11.5px] text-ink-100 outline-none transition-colors hover:bg-ink-800 focus-visible:ring-2 focus-visible:ring-accent-ring disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => setSavingName(null)}
                      className="cursor-pointer rounded-md px-2 py-1.5 text-[11.5px] text-ink-500 outline-none transition-colors hover:text-ink-100/80 focus-visible:ring-2 focus-visible:ring-accent-ring"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-[11.5px] text-ink-500">
                Fire several agents at once — one per row, each in its own working directory.
                Model / effort / background below apply to every task.
              </p>
              {rows.map((row, i) => (
                <div key={i} className="rounded-lg border border-ink-800 bg-ink-850 p-2.5">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-[11px] uppercase tracking-[0.08em] text-ink-500">
                      Task {i + 1}
                    </span>
                    {rows.length > 1 && (
                      <button
                        onClick={() => setRows((r) => r.filter((_, j) => j !== i))}
                        className="cursor-pointer rounded text-[11px] text-ink-500 outline-none transition-colors hover:text-status-failed focus-visible:ring-2 focus-visible:ring-accent-ring"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                  <input
                    list="cockpit-cwds"
                    value={row.cwd}
                    onChange={(e) =>
                      setRows((r) => r.map((x, j) => (j === i ? { ...x, cwd: e.target.value } : x)))
                    }
                    placeholder="Working directory"
                    className={`${inputCls} mb-2`}
                  />
                  <textarea
                    value={row.prompt}
                    onChange={(e) =>
                      setRows((r) =>
                        r.map((x, j) => (j === i ? { ...x, prompt: e.target.value } : x))
                      )
                    }
                    rows={2}
                    placeholder="Prompt"
                    className={`${inputCls} resize-y font-mono text-[12px]`}
                  />
                </div>
              ))}
              <datalist id="cockpit-cwds">
                {recentCwds.map((r) => (
                  <option key={r.cwd} value={r.cwd}>
                    {r.project}
                  </option>
                ))}
              </datalist>
              <button
                onClick={() => setRows((r) => [...r, { cwd: '', prompt: '' }])}
                className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-dashed border-ink-700 px-2.5 py-1.5 text-[11.5px] text-ink-500 outline-none transition-colors hover:border-ink-600 hover:text-ink-100/80 focus-visible:ring-2 focus-visible:ring-accent-ring"
              >
                <Plus size={13} strokeWidth={1.75} />
                Add task
              </button>

              <div className="grid grid-cols-2 gap-3 border-t border-ink-800 pt-3">
                <Field label="Model (all)">
                  <select value={model} onChange={(e) => setModel(e.target.value)} className={inputCls}>
                    <option value="">Default</option>
                    {MODEL_CHOICES.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Effort (all)">
                  <select
                    value={effort}
                    onChange={(e) => setEffort(e.target.value as EffortLevel | '')}
                    className={inputCls}
                  >
                    <option value="">Default</option>
                    {EFFORT_LEVELS.map((lvl) => (
                      <option key={lvl} value={lvl}>
                        {lvl}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <label className="flex items-center gap-2 text-[12.5px] text-ink-100/80">
                <input
                  type="checkbox"
                  checked={background}
                  onChange={(e) => setBackground(e.target.checked)}
                  className="h-3.5 w-3.5 accent-accent"
                />
                Run all as background agents
              </label>
            </div>
          )}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-ink-800 px-5 py-3">
          <button
            onClick={close}
            className="cursor-pointer rounded-md px-3 py-1.5 text-[12.5px] text-ink-500 outline-none transition-colors hover:text-ink-100/80 focus-visible:ring-2 focus-visible:ring-accent-ring"
          >
            Cancel
          </button>
          {mode === 'single' ? (
            <button
              onClick={onLaunch}
              disabled={!canLaunch}
              className="cursor-pointer rounded-md bg-accent px-3.5 py-1.5 text-[12.5px] font-medium text-ink-50 outline-none transition-colors hover:bg-accent-hover focus-visible:ring-2 focus-visible:ring-accent-ring disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? 'Launching…' : 'Launch'}
            </button>
          ) : (
            <button
              onClick={onDispatch}
              disabled={!canDispatch}
              className="cursor-pointer rounded-md bg-accent px-3.5 py-1.5 text-[12.5px] font-medium text-ink-50 outline-none transition-colors hover:bg-accent-hover focus-visible:ring-2 focus-visible:ring-accent-ring disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? 'Dispatching…' : `Dispatch ${rows.filter((r) => r.cwd.trim() && r.prompt.trim()).length}`}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}

const inputCls =
  'w-full rounded-md border border-ink-700 bg-ink-950 px-2.5 py-1.5 text-[12.5px] text-ink-100/90 outline-none transition-colors placeholder:text-ink-500 focus:border-accent focus:ring-2 focus:ring-accent-ring';

function Field({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] uppercase tracking-[0.08em] text-ink-500">{label}</span>
      {children}
    </label>
  );
}
