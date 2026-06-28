import { join } from 'node:path';
import { app, BrowserWindow, shell } from 'electron';

import { DataEngine } from './engine';
import { registerIpc } from './ipc';
import { createTray, destroyTray } from './tray';

let mainWindow: BrowserWindow | null = null;
let engine: DataEngine | null = null;

const getWindow = (): BrowserWindow | null => mainWindow;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 940,
    minHeight: 600,
    show: false,
    backgroundColor: '#0b0c0e',
    title: 'Cockpit',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());

  // Open external links in the OS browser, never in-app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  const rendererUrl = process.env['ELECTRON_RENDERER_URL'];
  if (rendererUrl) {
    void mainWindow.loadURL(rendererUrl);
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  // Start the engine first so the first snapshot is ready when the UI asks.
  engine = new DataEngine();
  try {
    await engine.start();
  } catch (err) {
    console.error('[main] engine failed to start (UI still loads):', (err as Error).message);
  }

  registerIpc(engine, getWindow);
  createWindow();
  createTray(getWindow);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  // Env-gated smoke affordance: auto-exit after N ms so a headless launch can
  // verify "boots without throwing" and then terminate on its own.
  const smokeMs = Number(process.env.COCKPIT_SMOKE);
  if (Number.isFinite(smokeMs) && smokeMs > 0) {
    console.error(`[main] COCKPIT_SMOKE set — will exit in ${smokeMs}ms`);
    setTimeout(() => {
      console.error('[main] smoke window elapsed — exiting cleanly');
      engine?.stop();
      destroyTray();
      app.exit(0);
    }, smokeMs);
  }
});

// Keep running in the tray when all windows are closed (desktop agent monitor).
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    // Stay alive in the tray; do NOT quit. Quit only via the tray menu.
  }
});

app.on('before-quit', () => {
  engine?.stop();
  destroyTray();
});

process.on('uncaughtException', (err) => {
  console.error('[main] uncaughtException (kept alive):', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[main] unhandledRejection (kept alive):', reason);
});
