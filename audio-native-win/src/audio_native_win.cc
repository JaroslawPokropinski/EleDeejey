#include "audio_native_win.h"
#include <Windows.h>
#include <audiopolicy.h>
#include <endpointvolume.h>
#include <objbase.h>
#include <mmdeviceapi.h>
#include <psapi.h>
#include <vector>
#include <string>

using namespace Napi;

// RAII helper for COM interfaces
template <typename T>
struct ScopedComPtr
{
  T *ptr = nullptr;
  ScopedComPtr() : ptr(nullptr) {}
  ScopedComPtr(T *p) : ptr(p) {}
  ~ScopedComPtr()
  {
    if (ptr)
      ptr->Release();
  }
  T **operator&() { return &ptr; }
  T *operator->() { return ptr; }
  operator T *() { return ptr; }
  T *Detach()
  {
    T *tmp = ptr;
    ptr = nullptr;
    return tmp;
  }
  void Release()
  {
    if (ptr)
    {
      ptr->Release();
      ptr = nullptr;
    }
  }
};

// RAII helper for CoInitializeEx
struct ScopedCoInit
{
  HRESULT hr;
  ScopedCoInit() { hr = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED); }
  ~ScopedCoInit()
  {
    if (SUCCEEDED(hr))
      CoUninitialize();
  }
  bool Failed() const { return FAILED(hr); }
};

static void ThrowComError(Napi::Env env, const char *msg, HRESULT hr)
{
  char buf[256];
  sprintf(buf, "%s: 0x%08X", msg, hr);
  Napi::Error::New(env, buf).ThrowAsJavaScriptException();
}

HRESULT AudioNativeWin::GetAllSessionsNative(Napi::Env env, std::vector<IAudioSessionControl2 *> *out, IAudioEndpointVolume **masterVolume)
{
  *masterVolume = nullptr;
  const CLSID CLSID_MMDeviceEnumerator = __uuidof(MMDeviceEnumerator);
  const IID IID_IMMDeviceEnumerator = __uuidof(IMMDeviceEnumerator);

  ScopedCoInit coInit;
  if (coInit.Failed())
  {
    ThrowComError(env, "CoInitialize failed", coInit.hr);
    return coInit.hr;
  }

  ScopedComPtr<IMMDeviceEnumerator> deviceEnumerator;
  ScopedComPtr<IMMDevice> speakers;
  ScopedComPtr<IAudioSessionManager2> sessionManager;
  ScopedComPtr<IAudioSessionEnumerator> sessionEnum;

  HRESULT hr = CoCreateInstance(CLSID_MMDeviceEnumerator, nullptr, CLSCTX_ALL, IID_IMMDeviceEnumerator, (LPVOID *)&deviceEnumerator);
  if (FAILED(hr))
  {
    ThrowComError(env, "CoCreateInstance failed for IMMDeviceEnumerator", hr);
    return hr;
  }

  hr = deviceEnumerator->GetDefaultAudioEndpoint(eRender, eMultimedia, &speakers);
  if (FAILED(hr))
  {
    ThrowComError(env, "GetDefaultAudioEndpoint failed", hr);
    return hr;
  }

  hr = speakers->Activate(__uuidof(IAudioEndpointVolume), CLSCTX_INPROC_SERVER, NULL, (LPVOID *)masterVolume);
  if (FAILED(hr))
  {
    ThrowComError(env, "Activate failed for IAudioEndpointVolume", hr);
    return hr;
  }

  hr = speakers->Activate(__uuidof(IAudioSessionManager2), CLSCTX_ALL, nullptr, (void **)&sessionManager);
  if (FAILED(hr))
  {
    ThrowComError(env, "Activate failed for IAudioSessionManager2", hr);
    return hr;
  }

  hr = sessionManager->GetSessionEnumerator(&sessionEnum);
  if (FAILED(hr))
  {
    ThrowComError(env, "GetSessionEnumerator failed", hr);
    return hr;
  }

  int count;
  sessionEnum->GetCount(&count);

  for (int i = 0; i < count; i++)
  {
    ScopedComPtr<IAudioSessionControl> session;
    hr = sessionEnum->GetSession(i, &session);
    if (FAILED(hr))
      continue;

    ScopedComPtr<IAudioSessionControl2> session2;
    hr = session->QueryInterface(__uuidof(IAudioSessionControl2), (void **)&session2);
    if (FAILED(hr))
      continue;

    if (session2)
    {
      out->push_back(session2.Detach());
    }
  }

  return S_OK;
}

AudioNativeWin::AudioNativeWin(const Napi::CallbackInfo &info) : ObjectWrap(info)
{
}

Napi::Value AudioNativeWin::GetAllSessions(const Napi::CallbackInfo &info)
{
  Napi::Env env = info.Env();
  std::vector<IAudioSessionControl2 *> sessions;
  IAudioEndpointVolume *masterVolume = nullptr;

  HRESULT hr = GetAllSessionsNative(env, &sessions, &masterVolume);
  if (FAILED(hr))
  {
    // Ensure cleanup of any sessions that might have been partially collected
    for (auto s : sessions) s->Release();
    if (masterVolume) masterVolume->Release();
    return env.Null();
  }

  ScopedComPtr<IAudioEndpointVolume> masterVolPtr(masterVolume);
  auto retArr = Napi::Array::New(env);

  size_t sessionLoopIdx = 0;
  for (size_t i = 0; i < sessions.size(); i++)
  {
    ScopedComPtr<IAudioSessionControl2> pSessionControl(sessions[i]);
    ScopedComPtr<ISimpleAudioVolume> simpleAudioVol;
    pSessionControl->QueryInterface(IID_PPV_ARGS(&simpleAudioVol));
    if (!simpleAudioVol)
    {
      continue;
    }

    DWORD processId = -1;
    pSessionControl->GetProcessId(&processId);

    auto obj = Napi::Object::New(env);
    obj.Set("pid", Napi::Number::New(env, processId));

    HANDLE hProcess = OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, FALSE, processId);
    char szProcessName[MAX_PATH] = "";
    if (hProcess)
    {
      GetProcessImageFileNameA(hProcess, szProcessName, MAX_PATH);
      CloseHandle(hProcess);
    }
    obj.Set("path", Napi::String::New(env, szProcessName));

    // Capture pointers by value and manage their lifetime via JS cleanup
    ISimpleAudioVolume *pVolRaw = simpleAudioVol.Detach();
    IAudioSessionControl2 *pCtrlRaw = pSessionControl.Detach();

    obj.Set("getVolume", Napi::Function::New(env, [=](const Napi::CallbackInfo &)
                                             {
      float volumeOut;
      pVolRaw->GetMasterVolume(&volumeOut);
      return Napi::Number::New(env, volumeOut); }));

    obj.Set("setVolume", Napi::Function::New(env, [=](const Napi::CallbackInfo &fooInfo)
                                             {
      pVolRaw->SetMasterVolume(fooInfo[0].As<Napi::Number>(), 0);
      return env.Undefined(); }));

    obj.Set("cleanup", Napi::Function::New(env, [=](const Napi::CallbackInfo &)
                                           {
      pVolRaw->Release();
      pCtrlRaw->Release();
      return env.Undefined(); }));

    retArr.Set(sessionLoopIdx++, obj);
  }

  auto masterVolObj = Napi::Object::New(env);
  masterVolObj.Set("master", Napi::Boolean::New(env, true));

  IAudioEndpointVolume *pMasterRaw = masterVolPtr.Detach();

  masterVolObj.Set("getVolume", Napi::Function::New(env, [=](const Napi::CallbackInfo &)
                                                    {
    float outVolume;
    pMasterRaw->GetMasterVolumeLevelScalar(&outVolume);
    return Napi::Number::New(env, outVolume); }));

  masterVolObj.Set("setVolume", Napi::Function::New(env, [=](const Napi::CallbackInfo &fooInfo)
                                                    {
    pMasterRaw->SetMasterVolumeLevelScalar(fooInfo[0].As<Napi::Number>(), 0);
    return env.Undefined(); }));

  masterVolObj.Set("cleanup", Napi::Function::New(env, [=](const Napi::CallbackInfo &)
                                                  {
    pMasterRaw->Release();
    return env.Undefined(); }));

  retArr.Set(sessionLoopIdx, masterVolObj);

  return retArr;
}

Napi::Value AudioNativeWin::GetProcessVolume(const Napi::CallbackInfo &info)
{
  Napi::Env env = info.Env();
  const CLSID CLSID_MMDeviceEnumerator = __uuidof(MMDeviceEnumerator);
  const IID IID_IMMDeviceEnumerator = __uuidof(IMMDeviceEnumerator);

  ScopedCoInit coInit;
  if (coInit.Failed())
  {
    ThrowComError(env, "CoInitialize failed", coInit.hr);
    return env.Null();
  }

  ScopedComPtr<IMMDeviceEnumerator> deviceEnumerator;
  ScopedComPtr<IMMDevice> speakers;
  ScopedComPtr<IAudioSessionManager2> sessionManager;
  ScopedComPtr<IAudioSessionEnumerator> sessionEnum;

  HRESULT hr = CoCreateInstance(CLSID_MMDeviceEnumerator, nullptr, CLSCTX_ALL, IID_IMMDeviceEnumerator, (LPVOID *)&deviceEnumerator);
  if (FAILED(hr))
  {
    ThrowComError(env, "CoCreateInstance failed for IMMDeviceEnumerator", hr);
    return env.Null();
  }

  hr = deviceEnumerator->GetDefaultAudioEndpoint(eRender, eMultimedia, &speakers);
  if (FAILED(hr))
  {
    ThrowComError(env, "GetDefaultAudioEndpoint failed", hr);
    return env.Null();
  }

  hr = speakers->Activate(__uuidof(IAudioSessionManager2), CLSCTX_ALL, nullptr, (void **)&sessionManager);
  if (FAILED(hr))
  {
    ThrowComError(env, "Activate failed for IAudioSessionManager2", hr);
    return env.Null();
  }

  hr = sessionManager->GetSessionEnumerator(&sessionEnum);
  if (FAILED(hr))
  {
    ThrowComError(env, "GetSessionEnumerator failed", hr);
    return env.Null();
  }

  int count;
  sessionEnum->GetCount(&count);

  for (int i = 0; i < count; i++)
  {
    ScopedComPtr<IAudioSessionControl> session;
    hr = sessionEnum->GetSession(i, &session);
    if (FAILED(hr))
      continue;

    ScopedComPtr<IAudioSessionControl2> session2;
    hr = session->QueryInterface(__uuidof(IAudioSessionControl2), (void **)&session2);
    if (FAILED(hr))
      continue;

    if (session2)
    {
      ScopedComPtr<ISimpleAudioVolume> simpleAudioVol;
      session2->QueryInterface(IID_PPV_ARGS(&simpleAudioVol));
      if (simpleAudioVol)
      {
        float volumeOut;
        simpleAudioVol->GetMasterVolume(&volumeOut);
        printf("vol: %f\n", volumeOut);
      }
    }
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
