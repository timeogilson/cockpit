import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { MODEL_CHOICES } from '@shared/control';
import { useStore } from '../../store/useStore';
import { useSessionStore } from '../../store/useSessionStore';

/**
 * NewSessionModal — start a new embedded `claude` terminal in a chosen project.
 * Matches LaunchDialog's modal chrome (see the `inputCls` / `Field` helpers at
 * the bottom, copied locally rather than exported from LaunchDialog).
 */

/** Parent directory of a path via string ops (strip trailing seps, cut last). */
function parentDir(p: string): string {
  const trimmed = p.replace(/[/\\]+$/, '');
  const cut = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  return cut > 0 ? trimmed.slice(0, cut) : trimmed;
}

export default function NewSessionModal({
  open,
  onClose
}: {
  open: boolean;
  onClose: () => void;
}): JSX.Element | null {
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

  const [cwd, setCwd] = useState('');
  const [model, setModel] = useState('');
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);

  // On open: default the cwd to the most recent project, else a home-ish dir
  // derived from app:info's claudeDir parent. Fail-soft.
  useEffect(() => {
    if (!open) return;
    const recent = recentCwds[0]?.cwd;
    if (recent) {
      setCwd((c) => c || recent);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const info = await window.cockpit?.invoke('app:info');
        if (cancelled || !info?.claudeDir) return;
        setCwd((c) => c || parentDir(info.claudeDir));
      } catch {
        /* fail-soft: leave cwd empty */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  function reset(): void {
    setModel('');
    setPrompt('');
  }

  async function onStart(): Promise<void> {
    if (!cwd.trim() || busy) return;
    setBusy(true);
    const ok = await useSessionStore.getState().newSession({
      cwd: cwd.trim(),
      model: model || undefined,
      prompt: prompt || undefined
    });
    setBusy(false);
    if (ok) {
      reset();
      onClose();
    }
  }

  const canStart = cwd.trim().length > 0 && !busy;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/55 p-6 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[86vh] w-[560px] max-w-full flex-col overflow-hidden rounded-xl border border-ink-700 bg-ink-900 shadow-card">
        <header className="flex items-center justify-between border-b border-ink-800 px-5 py-3.5">
          <h2 className="text-[14px] font-semibold text-ink-100/95">New session</h2>
          <button
            onClick={onClose}
            className="grid h-7 w-7 place-items-center rounded-md text-ink-500 hover:bg-ink-800 hover:text-ink-100/80"
            title="Close"
          >
            ✕
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div className="space-y-4">
            <Field label="Project / working directory">
              <input
                list="cockpit-session-cwds"
                value={cwd}
                onChange={(e) => setCwd(e.target.value)}
                placeholder="C:\path\to\project"
                className={inputCls}
              />
              <datalist id="cockpit-session-cwds">
                {recentCwds.map((r) => (
                  <option key={r.cwd} value={r.cwd}>
                    {r.project}
                  </option>
                ))}
              </datalist>
            </Field>

            <Field label="Model">
              <select value={model} onChange={(e) => setModel(e.target.value)} className={inputCls}>
                <option value="">Inherit (default)</option>
                {MODEL_CHOICES.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Initial prompt (optional)">
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={5}
                placeholder="Seed the session with a first prompt…"
                className={`${inputCls} resize-y font-mono text-[12px] leading-relaxed`}
              />
            </Field>
          </div>
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-ink-800 px-5 py-3">
          <button
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-[12.5px] text-ink-500 hover:text-ink-100/80"
          >
            Cancel
          </button>
          <button
            onClick={onStart}
            disabled={!canStart}
            className="rounded-md bg-accent px-3.5 py-1.5 text-[12.5px] font-medium text-white hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? 'Starting…' : 'Start session'}
          </button>
        </footer>
      </div>
    </div>
  );
}

const inputCls =
  'w-full rounded-md border border-ink-700 bg-ink-850 px-2.5 py-1.5 text-[12.5px] text-ink-100/90 outline-none placeholder:text-ink-600 focus:border-ink-500';

function Field({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] uppercase tracking-wide text-ink-600">{label}</span>
      {children}
    </label>
  );
}
