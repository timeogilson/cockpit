import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import {
  PUSH_CHANNELS,
  type CockpitApi,
  type InvokeCommand,
  type InvokeCommands,
  type PushChannel,
  type PushChannels
} from '@shared/ipc';

const api: CockpitApi = {
  subscribe<C extends PushChannel>(channel: C, cb: (data: PushChannels[C]) => void): () => void {
    if (!PUSH_CHANNELS.includes(channel)) {
      throw new Error(`[preload] refused to subscribe to unknown channel: ${channel}`);
    }
    const listener = (_event: IpcRendererEvent, data: PushChannels[C]): void => cb(data);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },

  invoke<C extends InvokeCommand>(
    command: C,
    payload?: InvokeCommands[C]['params']
  ): Promise<InvokeCommands[C]['result']> {
    return ipcRenderer.invoke(command, payload) as Promise<InvokeCommands[C]['result']>;
  }
};

// contextIsolation:true → expose only this locked-down, typed surface.
contextBridge.exposeInMainWorld('cockpit', api);
