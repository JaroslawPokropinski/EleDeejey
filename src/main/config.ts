import fs from 'fs';
import yaml from 'js-yaml';
import { app } from 'electron';
import logger from 'electron-log';

export interface Config {
  port: string;
  baudRate: number;
  slider_mapping: Record<number | string, string | string[]>;
}

const configPath = `${app.getPath('userData')}/config.yaml`;

const defaultConfig: Config = {
  port: 'COM15',
  baudRate: 9600,
  slider_mapping: {
    0: 'master',
    1: 'discord.exe',
    2: ['chrome.exe', 'brave.exe'],
    3: ['pathofexile_x64.exe', 'rocketleague.exe'],
  },
};

export function getOrCreateConfig(): Config {
  if (fs.existsSync(configPath)) {
    try {
      const loadedConfig = yaml.load(fs.readFileSync(configPath, 'utf8'));
      return {
        ...defaultConfig,
        ...(typeof loadedConfig === 'object' ? loadedConfig : {}),
      };
    } catch (error) {
      logger.error('Error loading config:', error);
      return defaultConfig;
    }
  }

  // create config file if it doesn't exist
  try {
    fs.writeFileSync(configPath, yaml.dump(defaultConfig));
  } catch (error) {
    logger.error('Error writing config:', error);
  }

  return defaultConfig;
}

export function saveConfig(config: Config): void {
  const yamlContent = yaml.dump(config);
  fs.writeFileSync(configPath, yamlContent);
}

export function getConfigPath(): string {
  return configPath;
}
