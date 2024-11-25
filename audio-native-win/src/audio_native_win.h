#pragma once

#include <napi.h>
#include <vector>
#include <audiopolicy.h>
#include <endpointvolume.h>

class AudioNativeWin : public Napi::ObjectWrap<AudioNativeWin>
{
public:
  AudioNativeWin(const Napi::CallbackInfo &);
  Napi::Value GetAllSessions(const Napi::CallbackInfo &);
  Napi::Value GetProcessVolume(const Napi::CallbackInfo &);

  static Napi::Function GetClass(Napi::Env);

private:
  HRESULT GetAllSessionsNative(std::vector<IAudioSessionControl2 *> *sessions, IAudioEndpointVolume **masterVolume);
};
