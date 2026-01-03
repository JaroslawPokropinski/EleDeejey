import { app, Menu, shell } from 'electron';
import { getConfigPath } from './config';

const configPath = getConfigPath();
export const contextMenu = Menu.buildFromTemplate([
  {
    label: 'Open config',
    type: 'normal',
    click: () => {
      // open the config file in user data
      shell.openPath(configPath);
    },
  },
  {
    label: 'Open logs',
    type: 'normal',
    click: () => {
      shell.openPath(`${app.getPath('userData')}/logs/`);
    },
  },
  { type: 'separator' },
  {
    label: 'Restart',
    type: 'normal',
    click: () => {
      app.relaunch();
      app.exit();
    },
  },
  { label: 'Exit', type: 'normal', click: () => app.quit() },
]);
