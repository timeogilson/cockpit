import { useControlStore, type ToastKind } from '../store/useControlStore';

const KIND_STYLE: Record<ToastKind, { border: string; dot: string }> = {
  info: { border: 'border-status-busy/40', dot: 'bg-status-busy' },
  success: { border: 'border-status-done/40', dot: 'bg-status-done' },
  error: { border: 'border-status-failed/50', dot: 'bg-status-failed' }
};

/** Bottom-right toast stack for control command results + errors. */
export default function Toasts(): JSX.Element {
  const toasts = useControlStore((s) => s.toasts);
  const dismiss = useControlStore((s) => s.dismissToast);

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-80 flex-col gap-2">
      {toasts.map((t) => {
        const style = KIND_STYLE[t.kind];
        return (
          <button
            key={t.id}
            onClick={() => dismiss(t.id)}
            className={`pointer-events-auto flex items-start gap-2 rounded-lg border ${style.border} bg-ink-850/95 px-3 py-2.5 text-left text-[12px] text-ink-100/85 shadow-card backdrop-blur transition-opacity hover:opacity-90`}
          >
            <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${style.dot}`} />
            <span className="min-w-0 break-words">{t.text}</span>
          </button>
        );
      })}
    </div>
  );
}
