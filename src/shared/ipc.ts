// Typed IPC contract — the single source of truth for the wire between
// the Node main process and the React renderer. Imported by main (to register
// handlers + push), preload (to build the bridge), and renderer (to consume).

import type { AgentsSnapshot, Usage, AppInfo } from './types';
import type {
  DispatchRequest,
  DispatchResult,
  FollowUpRequest,
  FollowUpResult,
  LaunchRequest,
  LaunchResult,
  NotifyConfig,
  SaveTemplateRequest,
  StopRequest,
  StopResult,
  TemplatesList
} from './control';

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
  // M4 — Controller commands.
  'control:launch': { params: LaunchRequest; result: LaunchResult };
  'control:stop': { params: StopRequest; result: StopResult };
  'control:followup': { params: FollowUpRequest; result: FollowUpResult };
  'control:dispatch': { params: DispatchRequest; result: DispatchResult };
  'control:templates:list': { params: void; result: TemplatesList };
  'control:templates:save': { params: SaveTemplateRequest; result: TemplatesList };
  // M6 — Notification settings.
  'notify:getConfig': { params: void; result: NotifyConfig };
  'notify:setConfig': { params: Partial<NotifyConfig>; result: NotifyConfig };
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
