import { useState } from 'react';
import type { TranscriptEvent } from '@shared/transcript';
import { formatTokens, sumTokens } from '../../lib/format';
import MarkdownView from './MarkdownView';
import ToolCall from './ToolCall';

function clockTime(ms: number): string {
  if (!ms) return '';
  try {
    return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return '';
  }
}

const KIND_LABEL: Record<TranscriptEvent['kind'], string> = {
  user: 'User',
  assistant: 'Assistant',
  system: 'System',
  tool: 'Tool result'
};

const KIND_ACCENT: Record<TranscriptEvent['kind'], string> = {
  user: 'text-status-busy',
  assistant: 'text-accent',
  system: 'text-ink-500',
  tool: 'text-status-done'
};

/** A long tool result, collapsed by default. */
function ToolResult({ text }: { text: string }): JSX.Element {
  const long = text.length > 280;
  const [open, setOpen] = useState(!long);
  const shown = open ? text : text.slice(0, 280) + '…';
  return (
    <div>
      <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-md border border-ink-800 bg-ink-900/70 px-2.5 py-2 font-mono text-[11px] leading-relaxed text-ink-200">
        {shown}
      </pre>
      {long && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="mt-1 text-[10.5px] text-ink-500 hover:text-ink-300"
        >
          {open ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  );
}

function EventRow({ event }: { event: TranscriptEvent }): JSX.Element {
  const time = clockTime(event.timestamp);
  const tokens = event.usage ? sumTokens(event.usage) : 0;

  return (
    <li className="relative pl-4">
      <span
        className={`absolute left-0 top-1.5 h-1.5 w-1.5 rounded-full ${
          event.kind === 'assistant' ? 'bg-accent/70' : event.kind === 'user' ? 'bg-status-busy' : 'bg-ink-600'
        }`}
      />
      <div className="mb-1 flex items-center gap-2 text-[10.5px] uppercase tracking-wide">
        <span className={`font-semibold ${KIND_ACCENT[event.kind]}`}>{KIND_LABEL[event.kind]}</span>
        {event.isSidechain && (
          <span className="rounded bg-ink-800 px-1 text-[9px] text-ink-500">subagent</span>
        )}
        {time && <span className="font-mono text-ink-500 normal-case">{time}</span>}
        {tokens > 0 && (
          <span className="ml-auto font-mono tabular-nums text-ink-500 normal-case" title="tokens this turn">
            {formatTokens(tokens)} tok
          </span>
        )}
      </div>

      {event.kind === 'assistant' ? (
        <>
          {event.markdown && <MarkdownView>{event.markdown}</MarkdownView>}
          {event.toolUses && event.toolUses.length > 0 && (
            <div className="mt-1.5 space-y-1">
              {event.toolUses.map((t, i) => (
                <ToolCall key={i} tool={t} />
              ))}
            </div>
          )}
          {!event.markdown && (!event.toolUses || event.toolUses.length === 0) && (
            <p className="text-[11.5px] italic text-ink-600">(no content)</p>
          )}
        </>
      ) : event.kind === 'tool' ? (
        event.text ? <ToolResult text={event.text} /> : <p className="text-[11.5px] italic text-ink-600">(empty result)</p>
      ) : event.kind === 'user' ? (
        <div className="whitespace-pre-wrap break-words rounded-md border border-ink-700/60 bg-ink-850 px-2.5 py-2 text-[12px] leading-relaxed text-ink-100/85">
          {event.text || <span className="italic text-ink-600">(empty)</span>}
        </div>
      ) : (
        <p className="whitespace-pre-wrap break-words text-[11.5px] leading-relaxed text-ink-500">
          {event.text}
        </p>
      )}
    </li>
  );
}

export default function TranscriptView({
  events,
  truncated,
  totalEvents
}: {
  events: TranscriptEvent[];
  truncated: boolean;
  totalEvents: number;
}): JSX.Element {
  if (events.length === 0) {
    return <p className="px-1 py-4 text-[12px] text-ink-600">No transcript events to show.</p>;
  }
  return (
    <div>
      <ol className="space-y-4 border-l border-ink-800 pl-1">
        {events.map((e, i) => (
          <EventRow key={e.uuid ?? i} event={e} />
        ))}
      </ol>
      {truncated && (
        <p className="mt-3 rounded-md border border-ink-800 bg-ink-900/60 px-3 py-2 text-[11px] text-ink-500">
          Showing the first {events.length} of {totalEvents} events. The transcript was capped for size.
        </p>
      )}
    </div>
  );
}
