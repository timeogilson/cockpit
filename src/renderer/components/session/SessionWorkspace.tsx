import { useState } from 'react';
import SessionsSidebar from './SessionsSidebar';
import SessionCenter from './SessionCenter';
import NewSessionModal from './NewSessionModal';

/**
 * SessionWorkspace — the Session tab body. Two columns here (sidebar + center);
 * the global <UsageRail/> mounted by App is the 3rd column, so we do NOT render
 * another one. Modal open-state is lifted here and passed down to the sidebar.
 */
export default function SessionWorkspace(): JSX.Element {
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <div className="flex h-full min-h-0 gap-3">
      <SessionsSidebar onNewSession={() => setModalOpen(true)} />
      <SessionCenter />
      <NewSessionModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </div>
  );
}
