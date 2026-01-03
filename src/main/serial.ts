import { SerialPort } from 'serialport';
import logger from 'electron-log';
import { AudioNativeWin } from 'audio-native-win';
import { Config, getOrCreateConfig } from './config';
import { watchConfigFile } from './ipc';

export async function openSerialPort(
  config: Config,
  onData: (data: string) => unknown,
): Promise<SerialPort> {
  return new Promise<SerialPort>((resolve, reject) => {
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
}

export async function startSerial(config: Config) {
  let port: SerialPort | null = null;
  const volumeArr = Object.values(config.slider_mapping).map(() => 0);

  let sessions = AudioNativeWin.getAllSessions();
  let lastSessionUpdate = new Date().getTime();

  logger.log(
    `Available audio sessions: ${sessions
      .filter((s) => s.name)
      .map((s) => `"${s.name}"`)
      .join(', ')}`,
  );

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
                if (appName === 'master') {
                  logger.log(`set volume to ${newVol} for ${appName}`);
                  sessions
                    .find((session) => session.master)
                    ?.setVolume(newVol / 100);
                }

                if (appName.endsWith('.exe')) {
                  sessions
                    .filter(
                      (session) =>
                        session.name?.toUpperCase() === appName.toUpperCase(),
                    )
                    .forEach((session) => {
                      logger.log(
                        `set volume to ${newVol} for ${session.name} ${session.pid}`,
                      );
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
}

export async function startConfigSerialWatch() {
  let config = getOrCreateConfig();
  let serial = await startSerial(config);

  watchConfigFile(() => {
    logger.log('config file changed, restarting...');
    config = getOrCreateConfig();
    serial.stop();
    startSerial(config)
      .then((newSerial) => {
        serial = newSerial;
      })
      .catch(logger.error);
  });
}
