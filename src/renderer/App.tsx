import { useEffect } from 'react';
import { useStore } from './store/useStore';
import TopNav from './components/TopNav';
import AgentsBoard from './components/AgentsBoard';
import UsageRail from './components/UsageRail';
import UsageView from './components/UsageView';
import Placeholder from './components/Placeholder';

export default function App(): JSX.Element {
  const tab = useStore((s) => s.tab);
  const init = useStore((s) => s.init);

  useEffect(() => {
    void init();
  }, [init]);

  return (
    <div className="flex h-full flex-col bg-ink-950 font-sans text-ink-100/90">
      <TopNav />
      <div className="flex min-h-0 flex-1">
        <main className="min-w-0 flex-1 overflow-hidden p-4">
          {tab === 'Agents' ? (
            <AgentsBoard />
          ) : tab === 'Usage' ? (
            <UsageView />
          ) : (
            <Placeholder tab={tab} />
          )}
        </main>
        <UsageRail />
      </div>
    </div>
  );
}
