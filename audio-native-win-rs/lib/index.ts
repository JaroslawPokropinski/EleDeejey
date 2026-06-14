/* eslint-disable @typescript-eslint/no-require-imports */
const addon = require('../index.node') as {
  GetProcessVolume(pid: string): number;
  GetAllSessions(): {
    pid: number;
    path: string;
    master?: boolean;
    getVolume: () => number;
    setVolume: (vol: number) => void;
    cleanup: () => void;
  }[];
};

export class AudioNativeWin {
  static getProcessVolume(pid: string) {
    return addon.GetProcessVolume(pid);
  }

  static getAllSessions() {
    return addon
      .GetAllSessions()
      .map((el) => ({
        ...el,
        name: el.path?.replace(/.+\\/g, '') || undefined,
        path: el.path || undefined,
      }))
      .sort((first, second) => first.pid - second.pid);
  }
}
