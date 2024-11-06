/* eslint-disable promise/no-nesting */
/* eslint global-require: off, no-console: off, promise/always-return: off */
import { app, shell, Tray, Menu } from 'electron';
import fs from 'fs';
import { SerialPort } from 'serialport';
import yaml from 'js-yaml';
import { exec } from 'child_process';
import path from 'path';
import logger from 'electron-log';
import { getAssetsPath } from './util';

let tray: Tray | null = null;

if (process.env.NODE_ENV === 'production') {
  const sourceMapSupport = require('source-map-support');
  sourceMapSupport.install();
}

const isDebug =
  process.env.NODE_ENV === 'development' || process.env.DEBUG_PROD === 'true';

if (isDebug) {
  require('electron-debug')();
}

const configPath = `${app.getPath('userData')}/config.yaml`;

function getOrCreateConfig() {
  const defaultConfig = {
    port: 'COM15',
    baudRate: 9600,
    nirCmdPath: 'nirCmd.exe',
    slider_mapping: {
      0: 'master',
      1: 'discord.exe',
      2: ['chrome.exe', 'brave.exe'],
      3: ['pathofexile_x64.exe', 'rocketleague.exe'],
    } as Record<number, string | string[]>,
  };

  if (fs.existsSync(configPath)) {
    const loadedConfig = yaml.load(fs.readFileSync(configPath, 'utf8'));
    return {
      ...defaultConfig,
      ...(typeof loadedConfig === 'object' ? loadedConfig : {}),
    };
  }

  // create config file if it doesn't exist
  fs.writeFileSync(configPath, yaml.dump(defaultConfig));

  return defaultConfig;
}

type Config = ReturnType<typeof getOrCreateConfig>;

const openSerialPort = async (config: Config, onData: (data: string) => void) =>
  new Promise<SerialPort>((resolve, reject) => {
    logger.log('open serial port');
    const port = new SerialPort({
      path: config.port,
      baudRate: config.baudRate,
    });

    port.on('error', (error) => {
      logger.error(error);
      reject(error);
    });

    port.on('open', () => {
      logger.log('open');
      resolve(port);
    });

    let dataBuffer = '';
    port.on('data', (chunk) => {
      if (!(chunk instanceof Buffer)) return;

      dataBuffer += chunk.toString();
      while (dataBuffer.includes('\n')) {
        const lines = dataBuffer.split('\n');
        const line = lines.shift()?.replace('\r', '');
        if (line) {
          onData(line);
        }
        dataBuffer = lines.join('\n');
      }
    });
  });

const startSerial = async (config: Config) => {
  let port: SerialPort | null = null;
  const volumeArr = Object.values(config.slider_mapping).map(() => 0);

  const serialInterval = setInterval(async () => {
    try {
      if (port === null || !port.isOpen) {
        port?.close();
        port?.destroy();
        port = await openSerialPort(config, (data) => {
          const newVolumeArr = data.split('|').map(Number);
          newVolumeArr.forEach((newVol, index) => {
            const oldVol = volumeArr[index];
            if (newVol !== oldVol) {
              volumeArr[index] = newVol;
              const slider = config.slider_mapping[index];
              const appArr = Array.isArray(slider) ? slider : [slider];

              appArr.forEach((appName) => {
                logger.log(`set volume to ${newVol} for ${appName}`);
                if (appName === 'master') {
                  exec(
                    `nircmd.exe setsysvolume ${Math.floor((newVol / 100) * 65535)}`,
                  );
                }

                if (appName.endsWith('.exe')) {
                  exec(`nircmd.exe setappvolume ${appName} ${newVol / 100}`);
                }
              });
            }
          });
        });
      } else {
        port.write('vol\n', 'utf8');
      }
    } catch (error) {
      logger.error('Error: ', error);
    }
  }, 200);

  return {
    stop: () => {
      clearInterval(serialInterval);
      port?.close();
      port?.destroy();
      port = null;
    },
  };
};

/**
 * Add event listeners...
 */
app.on('window-all-closed', () => {
  // Respect the OSX convention of having the application in memory even
  // after all windows have been closed
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app
  .whenReady()
  .then(async () => {
    let config = getOrCreateConfig();
    let serial = await startSerial(config);

    fs.watchFile(configPath, { persistent: false }, () => {
      logger.log('config file changed, restarting...');
      config = getOrCreateConfig();
      serial.stop();
      startSerial(config)
        .then((newSerial) => {
          serial = newSerial;
        })
        .catch(logger.error);
    });

    tray = new Tray(path.join(getAssetsPath(), 'assets', 'icons', '24x24.png'));

    const contextMenu = Menu.buildFromTemplate([
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
    tray.setToolTip('EleDeejey');
    tray.setContextMenu(contextMenu);
  })
  .catch(logger.error);
