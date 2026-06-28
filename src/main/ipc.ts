import { app, ipcMain, type BrowserWindow } from 'electron';
import type { AppInfo } from '@shared/types';
import { DataEngine, type EngineSnapshot, claudeDir, getTranscriptDetail } from './engine';
import { setTrayStatus } from './tray';

/**
 * Wire the DataEngine to typed IPC:
 *  - register request/response handlers (`engine:snapshot`, `app:info`)
 *  - push `agents:update` / `usage:update` streams to the renderer on change.
 */
export function registerIpc(engine: DataEngine, getWindow: () => BrowserWindow | null): void {
  let latest: EngineSnapshot | null = null;

  const push = (snap: EngineSnapshot): void => {
    latest = snap;
    const win = getWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send('agents:update', snap.agents);
      win.webContents.send('usage:update', snap.usage);
    }
    const busy = snap.agents.agents.filter((a) => a.status === 'busy').length;
    setTrayStatus(busy);
  };

  engine.on('snapshot', push);

  ipcMain.handle('engine:snapshot', () => {
    if (latest) return latest;
    return engine.getSnapshot();
  });

  ipcMain.handle('app:info', (): AppInfo => {
    return {
      app: app.getVersion(),
      electron: process.versions.electron ?? 'unknown',
      node: process.versions.node ?? 'unknown',
      chrome: process.versions.chrome ?? 'unknown',
      claudeDir: claudeDir()
    };
  });

  // M3 (additive): on-demand fetch of one session's full transcript detail.
  // Fail-soft — a thrown/parse error yields a notFound-style empty detail.
  ipcMain.handle('transcript:get', (_event, payload: { sessionId: string }) => {
    const sessionId = payload?.sessionId ?? '';
    try {
      return getTranscriptDetail(sessionId);
    } catch (err) {
      console.error('[ipc] transcript:get failed (fail-soft):', (err as Error).message);
      return getTranscriptDetail(''); // returns a safe notFound detail
    }
  });
}
