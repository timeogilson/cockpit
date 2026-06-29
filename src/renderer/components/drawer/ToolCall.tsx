import { useState } from 'react';
import { ChevronRight, FilePen, FilePlus, FileText, Search, Terminal, Wrench, type LucideIcon } from 'lucide-react';
import type { ToolUseSummary } from '@shared/transcript';

/** Pick a Lucide icon for a tool by its (loosely-named) kind. */
function iconForTool(name: string): LucideIcon {
  const n = name.toLowerCase();
  if (n.includes('read')) return FileText;
  if (n.includes('write')) return FilePlus;
  if (n.includes('edit')) return FilePen; // edit / multiedit
  if (n.includes('bash') || n.includes('shell') || n.includes('terminal')) return Terminal;
  if (n.includes('grep') || n.includes('search') || n.includes('glob') || n.includes('find')) return Search;
  return Wrench;
}

/**
 * Collapsible tool call: a compact one-line chip (tool name + short input
 * summary) that expands to show the resolved file path when present. Defaults
 * collapsed to keep long transcripts scannable.
 */
export default function ToolCall({ tool }: { tool: ToolUseSummary }): JSX.Element {
  const [open, setOpen] = useState(false);
  const hasDetail = Boolean(tool.filePath);
  const Icon = iconForTool(tool.name);

  return (
    <div className="rounded-md border border-ink-700/70 bg-ink-900/60">
      <button
        type="button"
        onClick={() => hasDetail && setOpen((v) => !v)}
        className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[11.5px] outline-none focus-visible:ring-2 focus-visible:ring-accent-ring ${
          hasDetail ? 'cursor-pointer hover:bg-ink-850' : 'cursor-default'
        }`}
      >
        {hasDetail && (
          <ChevronRight
            size={13}
            strokeWidth={1.75}
            className={`shrink-0 text-ink-500 transition-transform ${open ? 'rotate-90' : ''}`}
          />
        )}
        <span className="inline-flex items-center gap-1 rounded bg-ink-800 px-1.5 py-0.5 font-mono text-[10.5px] font-medium text-accent">
          <Icon size={12} strokeWidth={1.75} className="text-ink-400" />
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
