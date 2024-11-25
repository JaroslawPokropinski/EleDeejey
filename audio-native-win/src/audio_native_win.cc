#include "audio_native_win.h"
#include <Windows.h>
#include <audiopolicy.h>
#include <endpointvolume.h>
#include <objbase.h>
#include <mmdeviceapi.h>
#include <psapi.h>
#include <vector>

using namespace Napi;

HRESULT AudioNativeWin::GetAllSessionsNative(std::vector<IAudioSessionControl2 *> *out, IAudioEndpointVolume **masterVolume)
{
  const CLSID CLSID_MMDeviceEnumerator = __uuidof(MMDeviceEnumerator);
  const IID IID_IMMDeviceEnumerator = __uuidof(IMMDeviceEnumerator);

  HRESULT hr = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
  if (FAILED(hr))
  {
    printf("CoInitialize failed: 0x%x\n", hr);
    return hr;
  }

  IMMDeviceEnumerator *deviceEnumerator = nullptr;
  hr = CoCreateInstance(CLSID_MMDeviceEnumerator, nullptr, CLSCTX_ALL, IID_IMMDeviceEnumerator, (LPVOID *)&deviceEnumerator);
  if (FAILED(hr))
  {
    printf("CoCreateInstance failed for IMMDeviceEnumerator: 0x%x\n", hr);
    CoUninitialize();
    return hr;
  }

  IMMDevice *speakers;
  hr = deviceEnumerator->GetDefaultAudioEndpoint(eRender, eMultimedia, &speakers);

  if (FAILED(hr))
  {
    printf("GetDefaultAudioEndpoint failed: 0x%x\n", hr);
    return hr;
  }

  *masterVolume = NULL;
  hr = speakers->Activate(__uuidof(IAudioEndpointVolume), CLSCTX_INPROC_SERVER, NULL, (LPVOID *)masterVolume);

  if (FAILED(hr))
  {
    printf("GetDefaultAudioEndpoint failed: 0x%x\n", hr);
  }

  IAudioSessionManager2 *sessionManager;

  hr = speakers->Activate(__uuidof(IAudioSessionManager2), CLSCTX_ALL, nullptr, (void **)&sessionManager);

  if (FAILED(hr))
  {
    printf("Activate failed for IAudioSessionManager2: 0x%x\n", hr);
    return hr;
  }

  IAudioSessionEnumerator *sessionEnum;

  hr = sessionManager->GetSessionEnumerator(&sessionEnum);

  if (FAILED(hr))
  {
    printf("GetSessionEnumerator failed: 0x%x\n", hr);
    return hr;
  }

  int count;
  sessionEnum->GetCount(&count);

  for (int i = 0; i < count; i++)
  {
    IAudioSessionControl *session;
    hr = sessionEnum->GetSession(i, &session);

    if (FAILED(hr))
    {
      continue;
    }

    IAudioSessionControl2 *session2;
    hr = session->QueryInterface(__uuidof(IAudioSessionControl2), (void **)&session2);

    if (FAILED(hr))
    {
      continue;
    }

    if (session2)
    {
      out->push_back(session2);
    }
  }

  sessionEnum->Release();
  sessionManager->Release();
  CoUninitialize();

  return 0;
}

AudioNativeWin::AudioNativeWin(const Napi::CallbackInfo &info) : ObjectWrap(info)
{
}

Napi::Value AudioNativeWin::GetAllSessions(const Napi::CallbackInfo &info)
{
  std::vector<IAudioSessionControl2 *> sessions;
  IAudioEndpointVolume *masterVolume;
  GetAllSessionsNative(&sessions, &masterVolume);

  Napi::Env env = info.Env();
  auto retArr = Napi::Array::New(env);

  size_t sessionLoopIdx = 0;
  for (; sessionLoopIdx < sessions.size(); sessionLoopIdx++)
  {
    auto obj = Napi::Object::New(env);
    auto pSessionControl = sessions[sessionLoopIdx];
    ISimpleAudioVolume *simpleAudioVol = NULL;
    pSessionControl->QueryInterface(IID_PPV_ARGS(&simpleAudioVol));
    if (!simpleAudioVol)
    {
      continue;
    }

    DWORD processId = -1;
    pSessionControl->GetProcessId(&processId);

    obj.Set("pid", Napi::Number::New(env, processId));

    HANDLE hProcess = OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, FALSE, processId);
    char szProcessName[MAX_PATH] = "";
    GetProcessImageFileNameA(hProcess, szProcessName, MAX_PATH);
    CloseHandle(hProcess);

    obj.Set("path", Napi::String::New(env, szProcessName));

    obj.Set("getVolume", Napi::Function::New(env, [=](const Napi::CallbackInfo &)
                                             {
      float volumeOut;
      simpleAudioVol->GetMasterVolume(&volumeOut);

      return Napi::Number::New(env, volumeOut); }));

    obj.Set("setVolume", Napi::Function::New(env, [=](const Napi::CallbackInfo &fooInfo)
                                             {
      simpleAudioVol->SetMasterVolume(fooInfo[0].As<Napi::Number>(), 0);

      return env.Undefined(); }));

    obj.Set("cleanup", Napi::Function::New(env, [=](const Napi::CallbackInfo &)
                                           {
      simpleAudioVol->Release();
      pSessionControl->Release();

      return env.Undefined(); }));

    retArr.Set(sessionLoopIdx, obj);
  }

  auto masterVolObj = Napi::Object::New(env);

  masterVolObj.Set("master", Napi::Boolean::New(env, true));

  masterVolObj.Set("getVolume", Napi::Function::New(env, [=](const Napi::CallbackInfo &)
                                                    {
    float outVolume;
    masterVolume->GetMasterVolumeLevelScalar(&outVolume);

    return Napi::Number::New(env, outVolume); }));

  masterVolObj.Set("setVolume", Napi::Function::New(env, [=](const Napi::CallbackInfo &fooInfo)
                                                    {
    masterVolume->SetMasterVolumeLevelScalar(fooInfo[0].As<Napi::Number>(), 0);

    return env.Undefined(); }));

  masterVolObj.Set("cleanup", Napi::Function::New(env, [=](const Napi::CallbackInfo &)
                                                  {
    masterVolume->Release();

    return env.Undefined(); }));

  retArr.Set(sessionLoopIdx, masterVolObj);

  return retArr;
}

Napi::Value AudioNativeWin::GetProcessVolume(const Napi::CallbackInfo &info)
{
  Napi::Env env = info.Env();
  int pid = info[0].As<Napi::Number>();

  const CLSID CLSID_MMDeviceEnumerator = __uuidof(MMDeviceEnumerator);
  const IID IID_IMMDeviceEnumerator = __uuidof(IMMDeviceEnumerator);

  // guid "BCDE0395-E52F-467C-8E3D-C4579291692E"
  // const CLSID CLSID_MMDeviceEnumerator = {0xBCDE0395, 0xE52F, 0x467C, {0x8E, 0x3D, 0xC4, 0x57, 0x92, 0x91, 0x69, 0x2E}};

  HRESULT hr = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
  if (FAILED(hr))
  {
    printf("CoInitialize failed: 0x%x\n", hr);
    return env.Null();
  }

  IMMDeviceEnumerator *deviceEnumerator = nullptr;
  hr = CoCreateInstance(CLSID_MMDeviceEnumerator, nullptr, CLSCTX_ALL, IID_IMMDeviceEnumerator, (LPVOID *)&deviceEnumerator);
  if (FAILED(hr))
  {
    printf("CoCreateInstance failed for IMMDeviceEnumerator: 0x%x\n", hr);
    CoUninitialize();
    return env.Null();
  }

  IMMDevice *speakers;
  hr = deviceEnumerator->GetDefaultAudioEndpoint(eRender, eMultimedia, &speakers);

  if (FAILED(hr))
  {
    printf("GetDefaultAudioEndpoint failed: 0x%x\n", hr);
    return env.Null();
  }

  IAudioSessionManager2 *sessionManager;

  hr = speakers->Activate(__uuidof(IAudioSessionManager2), CLSCTX_ALL, nullptr, (void **)&sessionManager);

  if (FAILED(hr))
  {
    printf("Activate failed for IAudioSessionManager2: 0x%x\n", hr);
    return env.Null();
  }

  IAudioSessionEnumerator *sessionEnum;

  hr = sessionManager->GetSessionEnumerator(&sessionEnum);

  if (FAILED(hr))
  {
    printf("GetSessionEnumerator failed: 0x%x\n", hr);
    return env.Null();
  }

  std::vector<IAudioSessionControl2 *> sessions;
  int count;
  sessionEnum->GetCount(&count);

  printf("Count: %d\n", count);
  for (int i = 0; i < count; i++)
  {
    IAudioSessionControl *session;
    hr = sessionEnum->GetSession(i, &session);

    if (FAILED(hr))
    {
      continue;
    }

    IAudioSessionControl2 *session2;
    hr = session->QueryInterface(__uuidof(IAudioSessionControl2), (void **)&session2);

    if (FAILED(hr))
    {
      continue;
    }

    if (session2)
    {
      // hr = session2->IsSystemSoundsSession();
      // printf("IsSystemSoundsSession code: 0x%x\n", hr);
      // // assign session2 process name to string
      // DWORD processId = 0;
      // hr = session2->GetProcessId(&processId);
      // if (FAILED(hr))
      // {
      //   printf("GetProcessId failed: 0x%x\n", hr);
      // }
      // else
      // {
      //   wprintf(L"process: %d\n", processId);
      //   if (processId == 0)
      //   {
      //     continue;
      //   }
      // }

      sessions.push_back(session2);
    }
  }

  sessionEnum->Release();
  sessionManager->Release();
  CoUninitialize();

  // read volume for each session
  float volumeOut;

  for (int i = 0; i < sessions.size(); i++)
  {
    auto pSessionControl = sessions[i];
    ISimpleAudioVolume *simpleAudioVol = NULL;
    pSessionControl->QueryInterface(IID_PPV_ARGS(&simpleAudioVol));

    if (simpleAudioVol)
    {
      DWORD processId = -1;
      pSessionControl->GetProcessId(&processId);

      simpleAudioVol->GetMasterVolume(&volumeOut);
      printf("vol: %f\n", volumeOut);
      simpleAudioVol->Release();
    }
  }

  for (int i = 0; i < sessions.size(); i++)
  {
    sessions[i]->Release();
  }

  return env.Null();
}

Napi::Function AudioNativeWin::GetClass(Napi::Env env)
{
  return DefineClass(env, "AudioNativeWin", {
                                                AudioNativeWin::InstanceMethod("GetProcessVolume", &AudioNativeWin::GetProcessVolume),
                                                AudioNativeWin::InstanceMethod("GetAllSessions", &AudioNativeWin::GetAllSessions),
                                            });
}

Napi::Object Init(Napi::Env env, Napi::Object exports)
{
  Napi::String name = Napi::String::New(env, "AudioNativeWin");
  exports.Set(name, AudioNativeWin::GetClass(env));
  return exports;
}

NODE_API_MODULE(addon, Init)
