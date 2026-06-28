import { create } from 'zustand';
import type { AgentsSnapshot, Usage } from '@shared/types';
// M3 (additive): transcript detail for the drawer.
import type { TranscriptDetail } from '@shared/transcript';

export type Tab = 'Agents' | 'Sessions' | 'Projects' | 'Usage' | 'Config';

interface CockpitState {
  tab: Tab;
  setTab: (tab: Tab) => void;

  agents: AgentsSnapshot | null;
  usage: Usage | null;
  connected: boolean;

  setAgents: (s: AgentsSnapshot) => void;
  setUsage: (u: Usage) => void;
  setConnected: (c: boolean) => void;

  /** Pull the initial snapshot and wire push subscriptions. */
  init: () => Promise<void>;

  // M3 (additive): detail drawer state + actions.
  /** sessionId of the agent whose drawer is open, or null when closed. */
  selectedSessionId: string | null;
  /** Fetched transcript detail for the selected agent (null while loading/closed). */
  detail: TranscriptDetail | null;
  detailLoading: boolean;
  detailError: string | null;
  /** Open the drawer for an agent and fetch its transcript detail. */
  openAgent: (sessionId: string) => Promise<void>;
  /** Close the drawer and clear detail state. */
  closeDrawer: () => void;
}

export const useStore = create<CockpitState>((set, get) => ({
  tab: 'Agents',
  setTab: (tab) => set({ tab }),

  agents: null,
  usage: null,
  connected: false,

  setAgents: (agents) => set({ agents }),
  setUsage: (usage) => set({ usage }),
  setConnected: (connected) => set({ connected }),

  init: async () => {
    const api = window.cockpit;
    if (!api) {
      console.error('[renderer] window.cockpit bridge missing');
      set({ connected: false });
      return;
    }
    api.subscribe('agents:update', (s) => set({ agents: s, connected: true }));
    api.subscribe('usage:update', (u) => set({ usage: u }));
    try {
      const snap = await api.invoke('engine:snapshot');
      set({ agents: snap.agents, usage: snap.usage, connected: true });
    } catch (err) {
      console.error('[renderer] initial snapshot failed:', err);
      set({ connected: false });
    }
  },

  // M3 (additive): detail drawer.
  selectedSessionId: null,
  detail: null,
  detailLoading: false,
  detailError: null,

  openAgent: async (sessionId) => {
    set({ selectedSessionId: sessionId, detail: null, detailLoading: true, detailError: null });
    const api = window.cockpit;
    if (!api) {
      set({ detailLoading: false, detailError: 'bridge unavailable' });
      return;
    }
    try {
      const detail = await api.invoke('transcript:get', { sessionId });
      // Ignore a stale response if the user re-selected or closed in the meantime.
      if (get().selectedSessionId !== sessionId) return;
      set({ detail, detailLoading: false });
    } catch (err) {
      console.error('[renderer] transcript:get failed:', err);
      if (get().selectedSessionId !== sessionId) return;
      set({ detailLoading: false, detailError: 'Failed to load transcript.' });
    }
  },

  closeDrawer: () => set({ selectedSessionId: null, detail: null, detailLoading: false, detailError: null })
}));
