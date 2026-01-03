import { app, Tray } from 'electron';
import { electronApp, optimizer } from '@electron-toolkit/utils';
import icon24 from '../../resources/icons/24x24.png?asset';
import { contextMenu } from './contextMenu';
import { createWindow } from './window';
import { registerIpcHandlers } from './ipc';
import { startConfigSerialWatch } from './serial';

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('io.github.jaroslawpokropinski.eledeej');

  // Default open or close DevTools by F12 in development
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  const appWindow = createWindow();

  // Setup tray menu
  const tray = new Tray(icon24);
  tray.setToolTip('EleDeejey');
  tray.setContextMenu(contextMenu);
  tray.on('click', () => {
    appWindow.show();
  });

  registerIpcHandlers();
  startConfigSerialWatch();
});

// Quit when all windows are closed, except on macOS.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
