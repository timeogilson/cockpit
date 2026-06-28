export default function Placeholder({ tab }: { tab: string }): JSX.Element {
  return (
    <div className="grid h-full place-items-center">
      <div className="text-center">
        <div className="mx-auto mb-3 grid h-10 w-10 place-items-center rounded-lg border border-ink-700 bg-ink-850 text-ink-600">
          ◻
        </div>
        <h2 className="text-sm font-medium text-ink-100/80">{tab}</h2>
        <p className="mt-1 text-xs text-ink-600">Coming soon — part of a later slice.</p>
      </div>
    </div>
  );
}
