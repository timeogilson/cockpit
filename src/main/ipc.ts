import { app, ipcMain, type BrowserWindow } from 'electron';
import type { AppInfo } from '@shared/types';
import type {
  DispatchRequest,
  FollowUpRequest,
  LaunchRequest,
  SaveTemplateRequest,
  StopRequest,
  NotifyConfig
} from '@shared/control';
import type {
  PtyCreateRequest,
  PtyCreateResult,
  PtyKillRequest,
  PtyResizeRequest,
  PtyWriteRequest
} from '@shared/pty';
import { DataEngine, type EngineSnapshot, claudeDir, getTranscriptDetail } from './engine';
import { setTrayStatus } from './tray';
import { getController } from './controller';
import { getPtyManager } from './pty';
import { resolveClaudePath, buildClaudeArgs } from './pty/claude';
import { getNotifyConfig, onSnapshot as notifyOnSnapshot, setNotifyConfig } from './notifications';

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
    // M6: diff this snapshot for status-transition + budget notifications.
    notifyOnSnapshot(snap);
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

  // ---- M4: Controller commands ---------------------------------------------
  const controller = getController();

  ipcMain.handle('control:launch', (_e, req: LaunchRequest) => controller.launch(req));
  ipcMain.handle('control:stop', (_e, req: StopRequest) => controller.stop(req));
  ipcMain.handle('control:followup', (_e, req: FollowUpRequest) => controller.followUp(req));
  ipcMain.handle('control:dispatch', (_e, req: DispatchRequest) => controller.dispatchMany(req));
  ipcMain.handle('control:templates:list', () => controller.listTemplates());
  ipcMain.handle('control:templates:save', (_e, req: SaveTemplateRequest) =>
    controller.saveTemplate(req)
  );

  // ---- M6: Notification settings -------------------------------------------
  ipcMain.handle('notify:getConfig', () => getNotifyConfig());
  ipcMain.handle('notify:setConfig', (_e, partial: Partial<NotifyConfig>) =>
    setNotifyConfig(partial)
  );

  // ---- Session-shell: embedded terminal (node-pty) -------------------------
  const ptyManager = getPtyManager();

  // Stream pty output/exit to the renderer. Guard destroyed windows (mirror `push`).
  ptyManager.on('data', ({ id, chunk }) => {
    const win = getWindow();
    if (win && !win.isDestroyed()) win.webContents.send('pty:data', { id, chunk });
  });
  ptyManager.on('exit', ({ id, code }) => {
    const win = getWindow();
    if (win && !win.isDestroyed()) win.webContents.send('pty:exit', { id, code });
  });

  // Create — fail-soft: never throw across IPC, return { ok, id } | { ok:false, error }.
  ipcMain.handle('pty:create', (_e, req: PtyCreateRequest): PtyCreateResult => {
    try {
      // `shell:'claude'` is a sentinel: resolve the absolute claude path in MAIN
      // (Windows ConPTY needs it — see ./pty/claude) and build its interactive argv.
      if (req?.shell === 'claude') {
        const claudePath = resolveClaudePath();
        if (!claudePath) {
          return { ok: false, error: 'claude executable not found on PATH' };
        }
        const claudeReq: PtyCreateRequest = {
          ...req,
          shell: claudePath,
          args: [...buildClaudeArgs({ model: req.model, prompt: req.prompt }), ...(req.args ?? [])]
        };
        const id = ptyManager.create(claudeReq);
        return { ok: true, id };
      }
      const id = ptyManager.create(req);
      return { ok: true, id };
    } catch (err) {
      const error = (err as Error).message;
      console.error('[ipc] pty:create failed (fail-soft):', error);
      return { ok: false, error };
    }
  });

  ipcMain.handle('pty:write', (_e, req: PtyWriteRequest): void => {
    ptyManager.write(req?.id, req?.data ?? '');
  });

  ipcMain.handle('pty:resize', (_e, req: PtyResizeRequest): void => {
    ptyManager.resize(req?.id, req?.cols, req?.rows);
  });

  ipcMain.handle('pty:kill', (_e, req: PtyKillRequest): void => {
    ptyManager.kill(req?.id);
  });
}
