import { CircleAlert, CircleCheck, CircleX, type LucideIcon } from 'lucide-react';
import { useControlStore, type ToastKind } from '../store/useControlStore';

const KIND_STYLE: Record<ToastKind, { bar: string; text: string; icon: LucideIcon; label: string }> = {
  info: { bar: 'border-l-status-busy', text: 'text-status-busy', icon: CircleAlert, label: 'info' },
  success: { bar: 'border-l-status-done', text: 'text-status-done', icon: CircleCheck, label: 'success' },
  error: { bar: 'border-l-status-failed', text: 'text-status-failed', icon: CircleX, label: 'error' }
};

/** Bottom-right toast stack for control command results + errors. */
export default function Toasts(): JSX.Element {
  const toasts = useControlStore((s) => s.toasts);
  const dismiss = useControlStore((s) => s.dismissToast);

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-80 flex-col gap-2">
      {toasts.map((t) => {
        const style = KIND_STYLE[t.kind];
        const Icon = style.icon;
        return (
          <button
            key={t.id}
            onClick={() => dismiss(t.id)}
            aria-label={`Dismiss ${style.label} notification: ${t.text}`}
            className={`pointer-events-auto flex cursor-pointer items-start gap-2 rounded-lg border border-l-2 border-ink-700 ${style.bar} bg-ink-850 px-3 py-2.5 text-left text-[12px] text-ink-100 shadow-float backdrop-blur transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring`}
          >
            <Icon size={16} strokeWidth={1.75} className={`mt-px shrink-0 ${style.text}`} aria-hidden />
            <span className="min-w-0 break-words">{t.text}</span>
          </button>
        );
      })}
    </div>
  );
}
