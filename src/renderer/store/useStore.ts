import { create } from 'zustand';
import type { AgentsSnapshot, Usage } from '@shared/types';

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
}

export const useStore = create<CockpitState>((set) => ({
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
  }
}));
