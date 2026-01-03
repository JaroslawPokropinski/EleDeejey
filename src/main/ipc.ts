import { ipcMain } from 'electron';
import fs from 'fs';
import logger from 'electron-log';
import { getOrCreateConfig, saveConfig, getConfigPath, Config } from './config';
import { openWindows } from 'get-windows';

// const openWindows = require('get-windows').openWindows;

export function registerIpcHandlers(): void {
  ipcMain.on('load-config', (event) => {
    try {
      const config = getOrCreateConfig();
      event.reply('load-config', config);
    } catch (error) {
      logger.error('Error loading config:', error);
      event.reply('load-config-error', { error: 'Failed to load config' });
    }
  });

  ipcMain.on('save-config', (event, config: Config) => {
    try {
      saveConfig(config);
      event.reply('save-config-response', { success: true });
    } catch (error) {
      logger.error('Error saving config:', error);
      event.reply('save-config-response', {
        success: false,
        error: `Failed to save config: ${error}`,
      });
    }
  });

  ipcMain.on('get-processes', async (event) => {
    try {
      const windows = await openWindows();
      const processes = windows
        .map((win) => ({
          exe: win.owner.path.replace(/^.*[\\/]/, ''),
          area: win.bounds.width * win.bounds.height,
        }))
        .sort((a, b) => b.area - a.area)
        .map((win) => win.exe)
        .filter((name, index, arr) => arr.indexOf(name) === index);

      event.reply('get-processes', processes);
    } catch (error) {
      logger.error('Error getting processes:', error);
      event.reply('get-processes', []);
    }
  });
}

export function watchConfigFile(onChange: () => void): void {
  const configPath = getConfigPath();
  fs.watchFile(configPath, { persistent: false }, onChange);
}
