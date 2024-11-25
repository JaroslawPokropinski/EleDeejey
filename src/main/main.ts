/* eslint-disable promise/no-nesting */
/* eslint global-require: off, no-console: off, promise/always-return: off */
import { app, shell, Tray, Menu } from 'electron';
import fs from 'fs';
import { SerialPort } from 'serialport';
import yaml from 'js-yaml';
import path from 'path';
import logger from 'electron-log';
import AudioNativeWin from 'audio-native-win';
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

const openSerialPort = async (
  config: Config,
  onData: (data: string) => unknown,
) =>
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
        const lines = dataBuffer.split('\n').slice(-2);
        const [firstLine, lastLine] = lines;
        const line = firstLine?.replace('\r', '');
        if (line) {
          const res = onData(line);
          if (res instanceof Promise) {
            res.catch(logger.error);
          }
        }
        dataBuffer = lastLine ?? '';
      }
    });
  });

const startSerial = async (config: Config) => {
  let port: SerialPort | null = null;
  const volumeArr = Object.values(config.slider_mapping).map(() => 0);

  let sessions = AudioNativeWin.getAllSessions();
  let lastSessionUpdate = new Date().getTime();

  const serialInterval = setInterval(async () => {
    // update audio sessions
    const now = new Date().getTime();
    if (now - lastSessionUpdate > 1000) {
      lastSessionUpdate = now;
      sessions.forEach((session) => session.cleanup());
      sessions = AudioNativeWin.getAllSessions();
    }

    // handle serial
    try {
      if (port === null || !port.isOpen) {
        port?.close();
        port?.destroy();
        port = await openSerialPort(config, async (data) => {
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
                  sessions
                    .find((session) => session.master)
                    ?.setVolume(newVol / 100);
                }

                if (appName.endsWith('.exe')) {
                  sessions
                    .filter((session) => session.name === appName)
                    .forEach((session) => {
                      session.setVolume(newVol / 100);
                    });
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
