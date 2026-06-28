// Typed IPC contract — the single source of truth for the wire between
// the Node main process and the React renderer. Imported by main (to register
// handlers + push), preload (to build the bridge), and renderer (to consume).

import type { AgentsSnapshot, Usage, AppInfo } from './types';
// M3 (additive): transcript-detail payload for the detail drawer.
import type { TranscriptDetail } from './transcript';

/** Channels the main process PUSHES to the renderer (streams). */
export interface PushChannels {
  'agents:update': AgentsSnapshot;
  'usage:update': Usage;
}
export type PushChannel = keyof PushChannels;

export const PUSH_CHANNELS: readonly PushChannel[] = ['agents:update', 'usage:update'];

/** Request/response commands the renderer INVOKES on the main process. */
export interface InvokeCommands {
  'engine:snapshot': {
    params: void;
    result: { agents: AgentsSnapshot; usage: Usage };
  };
  'app:info': {
    params: void;
    result: AppInfo;
  };
  // M3 (additive): fetch one session's full, ordered transcript on demand.
  'transcript:get': {
    params: { sessionId: string };
    result: TranscriptDetail;
  };
}
export type InvokeCommand = keyof InvokeCommands;

/** Shape exposed on `window.cockpit` by the preload bridge. */
export interface CockpitApi {
  /**
   * Subscribe to a pushed stream. Returns an unsubscribe function.
   */
  subscribe<C extends PushChannel>(
    channel: C,
    cb: (data: PushChannels[C]) => void
  ): () => void;

  /**
   * Request/response call into the main process.
   */
  invoke<C extends InvokeCommand>(
    command: C,
    payload?: InvokeCommands[C]['params']
  ): Promise<InvokeCommands[C]['result']>;
}

declare global {
  interface Window {
    cockpit: CockpitApi;
  }
}
