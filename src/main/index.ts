import { join } from 'node:path';
import { app, BrowserWindow, shell } from 'electron';

import { DataEngine } from './engine';
import { registerIpc } from './ipc';
import { createTray, destroyTray } from './tray';
import { initNotifications } from './notifications';
import { getController } from './controller';
import { getPtyManager } from './pty';

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

/**
 * Headless PTY smoke (session-shell keystone proof). Gated on COCKPIT_PTY_SMOKE.
 * Spawns a real pseudo-terminal running the platform shell echoing a unique
 * sentinel, and asserts the sentinel round-trips back through node-pty within a
 * timeout — NO BrowserWindow, so it needs no display. Exits 0 on success, 1 on
 * failure/timeout.
 *
 * NB: on Windows ConPTY needs an absolute executable path (a bare `node` is not
 * PATH-resolved), so we drive the absolute ComSpec/SHELL — which also proves a
 * real child process streams output through the pty.
 */
function runPtySmoke(): void {
  const TIMEOUT_MS = 8000;
  const mgr = getPtyManager();
  const sentinel = `COCKPIT_PTY_OK_${Date.now().toString(36)}`;
  const isWin = process.platform === 'win32';
  const shell = isWin ? process.env.ComSpec || 'cmd.exe' : process.env.SHELL || '/bin/sh';
  const args = isWin ? ['/d', '/c', `echo ${sentinel}`] : ['-c', `echo ${sentinel}`];
  let buf = '';
  let done = false;

  const finish = (ok: boolean, msg: string): void => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    mgr.removeAllListeners('data');
    mgr.removeAllListeners('exit');
    console.error(`[pty-smoke] ${ok ? 'OK' : 'FAIL'} — ${msg}`);
    // Defer the hard exit a beat: tearing the process down the instant ConPTY's
    // native reader thread settles can fast-fail (0xC0000409) on Windows. A short
    // delay lets node-pty unwind cleanly so we exit with the intended code.
    setTimeout(() => app.exit(ok ? 0 : 1), 300);
  };

  const timer = setTimeout(() => {
    try {
      mgr.killAll();
    } catch {
      /* best-effort */
    }
    finish(false, `timeout after ${TIMEOUT_MS}ms; captured=${JSON.stringify(buf.slice(0, 160))}`);
  }, TIMEOUT_MS);

  // Success path waits for the child to exit on its own (`echo` then exit), so we
  // never kill a live pty out from under its reader thread.
  mgr.on('data', ({ chunk }) => {
    buf += chunk;
  });
  mgr.on('exit', ({ code }) => {
    if (buf.includes(sentinel)) {
      finish(true, `pty round-tripped sentinel ${sentinel} (child exit=${code})`);
    } else {
      finish(false, `child exited code=${code} without sentinel; captured=${JSON.stringify(buf.slice(0, 160))}`);
    }
  });

  try {
    const id = mgr.create({ cwd: process.cwd(), shell, args, cols: 80, rows: 24 });
    console.error(`[pty-smoke] spawned ${id} (${shell}) echoing ${sentinel} (timeout ${TIMEOUT_MS}ms)`);
  } catch (err) {
    finish(false, `create threw: ${(err as Error).message}`);
  }
}

app.whenReady().then(async () => {
  // Session-shell keystone proof: run the PTY smoke headlessly and exit, BEFORE
  // any window/engine/tray init (no display needed, nothing flashes).
  if (process.env.COCKPIT_PTY_SMOKE) {
    console.error('[pty-smoke] COCKPIT_PTY_SMOKE set — running headless PTY round-trip');
    runPtySmoke();
    return;
  }

  // Start the engine first so the first snapshot is ready when the UI asks.
  engine = new DataEngine();
  try {
    await engine.start();
  } catch (err) {
    console.error('[main] engine failed to start (UI still loads):', (err as Error).message);
  }

  // M6: load notification prefs + window getter before the first snapshot push.
  initNotifications(getWindow);
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
  // M4: best-effort kill of any foreground agents Cockpit launched.
  getController().stopAll();
  // Session-shell: tear down every live pseudo-terminal.
  getPtyManager().killAll();
  destroyTray();
});

process.on('uncaughtException', (err) => {
  console.error('[main] uncaughtException (kept alive):', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[main] unhandledRejection (kept alive):', reason);
});
