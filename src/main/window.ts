import {
  shell,
  BrowserWindow,
  BrowserWindowConstructorOptions,
} from 'electron';
import { join } from 'path';
import { is } from '@electron-toolkit/utils';
import icon from '../../resources/icon.png?asset';

export class WindowManager {
  private mainWindow: BrowserWindow | null = null;

  constructor(private options?: Partial<BrowserWindowConstructorOptions>) {}

  open() {
    if (this.mainWindow) {
      this.mainWindow.show();
      return;
    }

    this.mainWindow = new BrowserWindow({
      show: true,
      autoHideMenuBar: true,
      ...(process.platform === 'linux' ? { icon } : {}),
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        sandbox: false,
      },
      ...this.options,
    });

    this.mainWindow.webContents.setWindowOpenHandler((details) => {
      shell.openExternal(details.url);
      return { action: 'deny' };
    });

    // HMR for renderer base on electron-vite cli.
    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      this.mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
    } else {
      this.mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
    }

    this.mainWindow.on('closed', () => {
      this.mainWindow = null;
    });
  }
}
