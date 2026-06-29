import { useEffect, useState } from 'react';
import { Bell, X } from 'lucide-react';
import type { NotifyConfig } from '@shared/control';
import { DEFAULT_NOTIFY_CONFIG } from '@shared/control';
import { useControlStore } from '../store/useControlStore';

/** Modal panel: which engine events fire native notifications + budget alert. */
export default function NotificationsSettings(): JSX.Element | null {
  const open = useControlStore((s) => s.settingsOpen);
  const close = useControlStore((s) => s.closeSettings);
  const pushToast = useControlStore((s) => s.pushToast);

  const [cfg, setCfg] = useState<NotifyConfig>(DEFAULT_NOTIFY_CONFIG);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoaded(false);
    window.cockpit
      .invoke('notify:getConfig')
      .then((c) => {
        setCfg(c);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [open]);

  if (!open) return null;

  function patch(p: Partial<NotifyConfig>): void {
    const next = { ...cfg, ...p };
    setCfg(next);
    window.cockpit
      .invoke('notify:setConfig', p)
      .then((saved) => setCfg(saved))
      .catch(() => pushToast('error', 'Could not save notification settings.'));
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-6 backdrop-blur-[2px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="w-[420px] max-w-full overflow-hidden rounded-lg border border-ink-700 bg-ink-900 shadow-float">
        <header className="flex items-center justify-between border-b border-ink-800 px-5 py-3.5">
          <h2 className="flex items-center gap-2 text-[14px] font-semibold text-ink-100/95">
            <Bell size={15} strokeWidth={1.75} className="text-ink-400" />
            Notifications
          </h2>
          <button
            onClick={close}
            aria-label="Close"
            className="grid h-7 w-7 cursor-pointer place-items-center rounded-md text-ink-500 outline-none transition-colors hover:bg-ink-800 hover:text-ink-100/80 focus-visible:ring-2 focus-visible:ring-accent-ring"
          >
            <X size={16} strokeWidth={1.75} />
          </button>
        </header>

        <div className="space-y-1 px-5 py-4">
          {!loaded && <p className="py-4 text-center text-[12px] text-ink-500">Loading…</p>}
          {loaded && (
            <>
              <Toggle
                label="Agent needs input"
                desc="Notify when an agent pauses for you."
                checked={cfg.needsInput}
                onChange={(v) => patch({ needsInput: v })}
              />
              <Toggle
                label="Agent finished"
                desc="Notify when an agent completes."
                checked={cfg.done}
                onChange={(v) => patch({ done: v })}
              />
              <Toggle
                label="Agent failed"
                desc="Notify on errors / failures."
                checked={cfg.failed}
                onChange={(v) => patch({ failed: v })}
              />

              <div className="my-2 border-t border-ink-800" />

              <Toggle
                label="Daily budget alert"
                desc="Notify once/day when today's spend crosses the threshold."
                checked={cfg.budgetEnabled}
                onChange={(v) => patch({ budgetEnabled: v })}
              />
              <div className="flex items-center justify-between py-2 pl-1">
                <span className="text-[12.5px] text-ink-100/75">Budget threshold (USD)</span>
                <div className="flex items-center gap-1">
                  <span className="text-ink-500">$</span>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={cfg.budgetUsd}
                    disabled={!cfg.budgetEnabled}
                    onChange={(e) => patch({ budgetUsd: Math.max(0, Number(e.target.value) || 0) })}
                    className="w-20 rounded-md border border-ink-700 bg-ink-950 px-2 py-1 text-right font-mono text-[12.5px] tabular-nums text-ink-100/90 outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent-ring disabled:opacity-40"
                  />
                </div>
              </div>
            </>
          )}
        </div>

        <footer className="flex justify-end border-t border-ink-800 px-5 py-3">
          <button
            onClick={close}
            className="cursor-pointer rounded-md border border-ink-700 bg-ink-850 px-3.5 py-1.5 text-[12.5px] font-medium text-ink-100 outline-none transition-colors hover:bg-ink-800 focus-visible:ring-2 focus-visible:ring-accent-ring"
          >
            Done
          </button>
        </footer>
      </div>
    </div>
  );
}

function Toggle({
  label,
  desc,
  checked,
  onChange
}: {
  label: string;
  desc: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}): JSX.Element {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-3 py-2 pl-1">
      <span className="min-w-0">
        <span className="block text-[12.5px] text-ink-100/85">{label}</span>
        <span className="block text-[11px] text-ink-500">{desc}</span>
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 h-4 w-4 shrink-0 accent-accent"
      />
    </label>
  );
}
