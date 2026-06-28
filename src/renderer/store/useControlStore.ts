import { create } from 'zustand';
import type {
  DispatchRequest,
  FollowUpRequest,
  LaunchRequest,
  StopRequest
} from '@shared/control';

/**
 * Control + UI-chrome store for the M4/M6 surface (launch dialog, follow-up,
 * stop, notification settings, toasts). Kept separate from the read-only
 * engine store (useStore) so the control half is fully additive.
 */

export type ToastKind = 'info' | 'success' | 'error';
export interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
}

interface ControlState {
  launchOpen: boolean;
  settingsOpen: boolean;
  followUpFor: { sessionId: string; title: string } | null;
  toasts: Toast[];

  openLaunch: () => void;
  closeLaunch: () => void;
  openSettings: () => void;
  closeSettings: () => void;
  openFollowUp: (sessionId: string, title: string) => void;
  closeFollowUp: () => void;

  pushToast: (kind: ToastKind, text: string) => void;
  dismissToast: (id: number) => void;

  launch: (req: LaunchRequest) => Promise<boolean>;
  dispatch: (req: DispatchRequest) => Promise<boolean>;
  stop: (req: StopRequest, label?: string) => Promise<void>;
  followUp: (req: FollowUpRequest) => Promise<void>;
}

let toastSeq = 1;

export const useControlStore = create<ControlState>((set, get) => ({
  launchOpen: false,
  settingsOpen: false,
  followUpFor: null,
  toasts: [],

  openLaunch: () => set({ launchOpen: true }),
  closeLaunch: () => set({ launchOpen: false }),
  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
  openFollowUp: (sessionId, title) => set({ followUpFor: { sessionId, title } }),
  closeFollowUp: () => set({ followUpFor: null }),

  pushToast: (kind, text) => {
    const id = toastSeq++;
    set((s) => ({ toasts: [...s.toasts, { id, kind, text }] }));
    // Auto-dismiss; errors linger a little longer.
    setTimeout(() => get().dismissToast(id), kind === 'error' ? 6000 : 3500);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  launch: async (req) => {
    const api = window.cockpit;
    if (!api) {
      get().pushToast('error', 'Bridge unavailable — cannot launch.');
      return false;
    }
    try {
      const res = await api.invoke('control:launch', req);
      if (res.ok) {
        get().pushToast(
          'success',
          res.dryRun
            ? `Dry-run: built launch for ${req.cwd}`
            : `Launched agent in ${req.cwd}`
        );
        return true;
      }
      get().pushToast('error', res.error ?? 'Launch failed.');
      return false;
    } catch (err) {
      get().pushToast('error', `Launch failed: ${(err as Error).message}`);
      return false;
    }
  },

  dispatch: async (req) => {
    const api = window.cockpit;
    if (!api) {
      get().pushToast('error', 'Bridge unavailable — cannot dispatch.');
      return false;
    }
    try {
      const res = await api.invoke('control:dispatch', req);
      const okCount = res.results.filter((r) => r.ok).length;
      if (res.ok) {
        get().pushToast('success', `Dispatched ${okCount}/${res.results.length} agents.`);
      } else {
        get().pushToast(
          'error',
          `Dispatched ${okCount}/${res.results.length}; some failed.`
        );
      }
      return res.ok;
    } catch (err) {
      get().pushToast('error', `Dispatch failed: ${(err as Error).message}`);
      return false;
    }
  },

  stop: async (req, label) => {
    const api = window.cockpit;
    if (!api) {
      get().pushToast('error', 'Bridge unavailable — cannot stop.');
      return;
    }
    try {
      const res = await api.invoke('control:stop', req);
      if (res.ok) {
        get().pushToast(
          'info',
          res.dryRun
            ? `Dry-run: would stop ${label ?? 'agent'}`
            : `Stopped ${label ?? 'agent'} (pid ${res.killed?.join(', ') ?? '?'})`
        );
      } else {
        get().pushToast('error', res.error ?? 'Stop failed.');
      }
    } catch (err) {
      get().pushToast('error', `Stop failed: ${(err as Error).message}`);
    }
  },

  followUp: async (req) => {
    const api = window.cockpit;
    if (!api) {
      get().pushToast('error', 'Bridge unavailable — cannot follow up.');
      return;
    }
    try {
      const res = await api.invoke('control:followup', req);
      if (res.ok) {
        get().pushToast(
          'success',
          res.dryRun ? 'Dry-run: built follow-up.' : 'Follow-up sent.'
        );
      } else {
        get().pushToast('error', res.error ?? 'Follow-up failed.');
      }
    } catch (err) {
      get().pushToast('error', `Follow-up failed: ${(err as Error).message}`);
    }
  }
}));
