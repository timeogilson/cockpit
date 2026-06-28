import { useState } from 'react';
import type { ToolUseSummary } from '@shared/transcript';

/**
 * Collapsible tool call: a compact one-line chip (tool name + short input
 * summary) that expands to show the resolved file path when present. Defaults
 * collapsed to keep long transcripts scannable.
 */
export default function ToolCall({ tool }: { tool: ToolUseSummary }): JSX.Element {
  const [open, setOpen] = useState(false);
  const hasDetail = Boolean(tool.filePath);

  return (
    <div className="rounded-md border border-ink-700/70 bg-ink-900/60">
      <button
        type="button"
        onClick={() => hasDetail && setOpen((v) => !v)}
        className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[11.5px] ${
          hasDetail ? 'cursor-pointer hover:bg-ink-850' : 'cursor-default'
        }`}
      >
        {hasDetail && (
          <span className={`text-ink-600 transition-transform ${open ? 'rotate-90' : ''}`}>›</span>
        )}
        <span className="rounded bg-ink-800 px-1.5 py-0.5 font-mono text-[10.5px] font-medium text-accent-soft">
          {tool.name}
        </span>
        <span className="min-w-0 flex-1 truncate text-ink-100/65" title={tool.inputSummary}>
          {tool.inputSummary}
        </span>
      </button>
      {open && tool.filePath && (
        <div className="border-t border-ink-800 px-2.5 py-1.5">
          <code className="block break-all font-mono text-[11px] text-ink-300">{tool.filePath}</code>
        </div>
      )}
    </div>
  );
}
