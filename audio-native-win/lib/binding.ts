const addon = require('../build/Release/audio-native-win-native');

interface IAudioNativeWinNative {
  GetProcessVolume(pid: string): number;
  GetAllSessions(): {
    pid: number;
    path: string;
    master?: boolean;
    getVolume: () => number;
    setVolume: (vol: number) => void;
    cleanup: () => void;
  }[];
}

class AudioNativeWin {
  constructor() {
    this.addonInstance = new addon.AudioNativeWin();
  }

  getProcessVolume(pid: string) {
    return this.addonInstance.GetProcessVolume(pid);
  }

  getAllSessions() {
    return this.addonInstance
      .GetAllSessions()
      .map((el) => ({
        ...el,
        name: el.path?.replace(/.+\\/g, '') || undefined,
        path: el.path || undefined,
      }))
      .sort((first, second) => first.pid - second.pid);
  }

  // private members
  private addonInstance: IAudioNativeWinNative;
}
const audioNativeWin = new AudioNativeWin();
export default audioNativeWin;
