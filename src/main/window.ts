import {
  shell,
  BrowserWindow,
  BrowserWindowConstructorOptions,
} from 'electron';
import { join } from 'path';
import { is } from '@electron-toolkit/utils';
import icon from '../../resources/icon.png?asset';

export function createWindow(
  options?: Partial<BrowserWindowConstructorOptions>,
) {
  const mainWindow = new BrowserWindow({
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
    },
    ...options,
  });

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: 'deny' };
  });

  // HMR for renderer base on electron-vite cli.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }

  mainWindow.on('close', (event) => {
    if (mainWindow.isVisible()) {
      event.preventDefault();
    }
    mainWindow.hide();
  });

  mainWindow.on('minimize', () => {
    mainWindow.hide();
  });

  return mainWindow;
}
