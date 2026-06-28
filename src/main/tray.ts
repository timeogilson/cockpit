import { app, Menu, Tray, nativeImage, type BrowserWindow } from 'electron';
import { TRAY_ICON_PNG_BASE64 } from './trayIcon';

let tray: Tray | null = null;

function trayImage(): Electron.NativeImage {
  try {
    const img = nativeImage.createFromBuffer(Buffer.from(TRAY_ICON_PNG_BASE64, 'base64'));
    if (!img.isEmpty()) return img;
  } catch {
    /* fall through */
  }
  return nativeImage.createEmpty();
}

/** Create the system tray with Show/Quit menu; click toggles the window. */
export function createTray(getWindow: () => BrowserWindow | null): Tray {
  const showWindow = (): void => {
    const win = getWindow();
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  };

  tray = new Tray(trayImage());
  tray.setToolTip('Cockpit — Claude Code agent center');

  const menu = Menu.buildFromTemplate([
    { label: 'Show Cockpit', click: showWindow },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.quit();
      }
    }
  ]);
  tray.setContextMenu(menu);
  tray.on('click', showWindow);

  return tray;
}

/** Update the tray tooltip with a live busy count. */
export function setTrayStatus(busyCount: number): void {
  if (!tray) return;
  const suffix = busyCount > 0 ? ` — ${busyCount} busy` : '';
  tray.setToolTip(`Cockpit — Claude Code agent center${suffix}`);
}

export function destroyTray(): void {
  tray?.destroy();
  tray = null;
}
