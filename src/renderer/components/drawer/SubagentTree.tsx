import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import type { SubagentNode } from '@shared/transcript';
import { elapsed, formatCost, formatTokens, modelLabel, sumTokens } from '../../lib/format';

function Node({ node, depth }: { node: SubagentNode; depth: number }): JSX.Element {
  const [open, setOpen] = useState(false);
  const hasChildren = node.children.length > 0;
  const tokens = sumTokens(node.tokens);

  return (
    <li>
      <div
        className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-ink-850"
        style={{ marginLeft: depth * 12 }}
      >
        <button
          type="button"
          onClick={() => hasChildren && setOpen((v) => !v)}
          className={`grid place-items-center rounded text-ink-500 outline-none focus-visible:ring-2 focus-visible:ring-accent-ring ${
            hasChildren ? 'cursor-pointer' : 'cursor-default opacity-0'
          }`}
          aria-label={open ? 'collapse' : 'expand'}
        >
          <ChevronRight
            size={13}
            strokeWidth={1.75}
            className={`transition-transform ${open ? 'rotate-90' : ''}`}
          />
        </button>
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-status-busy/70" />
        <span className="min-w-0 flex-1 truncate text-[12px] text-ink-100/85" title={node.title}>
          {node.title}
        </span>
        <span className="rounded border border-ink-700 bg-ink-800 px-1.5 py-0.5 font-mono text-[10px] text-ink-100/60">
          {modelLabel(node.model)}
        </span>
        <span className="w-14 text-right font-mono text-[11px] tabular-nums text-ink-400">{formatCost(node.costUsd)}</span>
      </div>
      <div className="ml-7 flex flex-wrap gap-x-3 gap-y-0.5 pb-1 font-mono text-[10.5px] tabular-nums text-ink-500" style={{ marginLeft: depth * 12 + 28 }}>
        <span>{formatTokens(tokens)} tok</span>
        <span>{node.eventCount} events</span>
        {node.startedAt > 0 && node.lastActivityAt > 0 && (
          <span>{elapsed(node.startedAt, node.lastActivityAt)}</span>
        )}
        {node.estimated && <span title="estimated pricing">est.</span>}
      </div>
      {open && hasChildren && (
        <ul>
          {node.children.map((c) => (
            <Node key={c.id} node={c} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

export default function SubagentTree({ subagents }: { subagents: SubagentNode[] }): JSX.Element {
  if (subagents.length === 0) {
    return <p className="text-[11.5px] text-ink-600">No subagents were spawned by this session.</p>;
  }
  const totalCost = subagents.reduce((s, n) => s + n.costUsd, 0);
  return (
    <div>
      <p className="mb-1.5 text-[11px] text-ink-500">
        {subagents.length} subagent{subagents.length === 1 ? '' : 's'} ·{' '}
        <span className="font-mono tabular-nums">{formatCost(totalCost)}</span> combined
      </p>
      <ul className="space-y-0.5">
        {subagents.map((n) => (
          <Node key={n.id} node={n} depth={0} />
        ))}
      </ul>
    </div>
  );
}
