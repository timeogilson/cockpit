import { useState } from 'react';
import { useControlStore } from '../store/useControlStore';

/** Small modal to send a follow-up / resume message to a session. */
export default function FollowUpDialog(): JSX.Element | null {
  const target = useControlStore((s) => s.followUpFor);
  const close = useControlStore((s) => s.closeFollowUp);
  const followUp = useControlStore((s) => s.followUp);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  if (!target) return null;

  async function send(): Promise<void> {
    if (!target || !message.trim()) return;
    setBusy(true);
    await followUp({ sessionId: target.sessionId, message: message.trim() });
    setBusy(false);
    setMessage('');
    close();
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/55 p-6 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="w-[480px] max-w-full overflow-hidden rounded-xl border border-ink-700 bg-ink-900 shadow-card">
        <header className="border-b border-ink-800 px-5 py-3.5">
          <h2 className="text-[14px] font-semibold text-ink-100/95">Follow up</h2>
          <p className="mt-0.5 truncate text-[11.5px] text-ink-500" title={target.title}>
            {target.title}
          </p>
        </header>
        <div className="px-5 py-4">
          <textarea
            autoFocus
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={4}
            placeholder="Message to resume the session with…"
            className="w-full resize-y rounded-md border border-ink-700 bg-ink-850 px-2.5 py-1.5 font-mono text-[12px] leading-relaxed text-ink-100/90 outline-none placeholder:text-ink-600 focus:border-ink-500"
          />
          <p className="mt-2 text-[11px] text-ink-600">
            Resumes via <code className="text-ink-500">claude --resume {target.sessionId.slice(0, 8)}… --print</code>
          </p>
        </div>
        <footer className="flex justify-end gap-2 border-t border-ink-800 px-5 py-3">
          <button
            onClick={close}
            className="rounded-md px-3 py-1.5 text-[12.5px] text-ink-500 hover:text-ink-100/80"
          >
            Cancel
          </button>
          <button
            onClick={send}
            disabled={!message.trim() || busy}
            className="rounded-md bg-accent px-3.5 py-1.5 text-[12.5px] font-medium text-white hover:bg-accent-soft disabled:opacity-40"
          >
            {busy ? 'Sending…' : 'Send'}
          </button>
        </footer>
      </div>
    </div>
  );
}
