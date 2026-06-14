use neon::prelude::*;
use std::sync::{Arc, Mutex};
use windows::Win32::Foundation::{CloseHandle, HANDLE};
use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
use windows::Win32::Media::Audio::*;
use windows::Win32::System::Com::*;
use windows::Win32::System::Threading::{
    OpenProcess, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION, QueryFullProcessImageNameW,
};
use windows::core::{AgileReference, Interface, PWSTR};

//
// =======================
// HANDLE RAII
// =======================
//

struct WinHandle(HANDLE);

impl Drop for WinHandle {
    fn drop(&mut self) {
        unsafe {
            let _ = CloseHandle(self.0);
        }
    }
}

//
// =======================
// AGILE VOLUME CONTROL
// =======================
//

enum AgileVolumeControl {
    Session(AgileReference<ISimpleAudioVolume>),
    Master(AgileReference<IAudioEndpointVolume>),
}

impl AgileVolumeControl {
    fn get_volume(&self) -> f32 {
        match self {
            Self::Session(r) => {
                if let Ok(s) = r.resolve() {
                    unsafe { s.GetMasterVolume().unwrap_or(0.0) }
                } else {
                    0.0
                }
            }
            Self::Master(r) => {
                if let Ok(m) = r.resolve() {
                    unsafe { m.GetMasterVolumeLevelScalar().unwrap_or(0.0) }
                } else {
                    0.0
                }
            }
        }
    }

    fn set_volume(&self, vol: f32) {
        match self {
            Self::Session(r) => {
                if let Ok(s) = r.resolve() {
                    unsafe {
                        let _ = s.SetMasterVolume(vol, std::ptr::null_mut());
                    }
                }
            }
            Self::Master(r) => {
                if let Ok(m) = r.resolve() {
                    unsafe {
                        let _ = m.SetMasterVolumeLevelScalar(vol, std::ptr::null_mut());
                    }
                }
            }
        }
    }
}

//
// =======================
// STATE (IN JSBOX)
// =======================
//

struct VolumeState {
    control: Mutex<Option<AgileVolumeControl>>,
}

impl Finalize for VolumeState {}

//
// =======================
// PROCESS PATH
// =======================
//

fn get_process_path(pid: u32) -> String {
    if pid == 0 {
        return String::new();
    }

    let handle = unsafe {
        match OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) {
            Ok(h) => WinHandle(h),
            Err(_) => return String::new(),
        }
    };

    let mut buf = [0u16; 1024];
    let mut len = buf.len() as u32;

    let success = unsafe {
        QueryFullProcessImageNameW(
            handle.0,
            PROCESS_NAME_WIN32,
            PWSTR(buf.as_mut_ptr()),
            &mut len,
        )
        .is_ok()
    };

    if success {
        String::from_utf16_lossy(&buf[..len as usize])
    } else {
        String::new()
    }
}

//
// =======================
// SHARED METHODS
// =======================
//

fn method_get_volume(mut cx: FunctionContext) -> JsResult<JsNumber> {
    let this: Handle<JsValue> = cx.this()?;
    let obj = this.downcast_or_throw::<JsObject, _>(&mut cx)?;
    let state: Handle<JsBox<Arc<VolumeState>>> = obj.get::<JsBox<Arc<VolumeState>>, _, _>(&mut cx, "_state")?;
    
    let guard = state.control.lock().unwrap();
    if let Some(control) = &*guard {
        let vol = control.get_volume();
        return Ok(cx.number(vol as f64));
    }
    
    Ok(cx.number(0.0))
}

fn method_set_volume(mut cx: FunctionContext) -> JsResult<JsUndefined> {
    let vol = cx.argument::<JsNumber>(0)?.value(&mut cx) as f32;
    let this: Handle<JsValue> = cx.this()?;
    let obj = this.downcast_or_throw::<JsObject, _>(&mut cx)?;
    let state: Handle<JsBox<Arc<VolumeState>>> = obj.get::<JsBox<Arc<VolumeState>>, _, _>(&mut cx, "_state")?;
    
    let guard = state.control.lock().unwrap();
    if let Some(control) = &*guard {
        control.set_volume(vol);
    }
    
    Ok(cx.undefined())
}

fn method_cleanup(mut cx: FunctionContext) -> JsResult<JsUndefined> {
    let this: Handle<JsValue> = cx.this()?;
    let obj = this.downcast_or_throw::<JsObject, _>(&mut cx)?;
    let state: Handle<JsBox<Arc<VolumeState>>> = obj.get::<JsBox<Arc<VolumeState>>, _, _>(&mut cx, "_state")?;
    
    let mut guard = state.control.lock().unwrap();
    *guard = None;
    
    Ok(cx.undefined())
}

//
// =======================
// MAIN FUNCTION
// =======================
//

fn ensure_com() {
    struct ComInit(bool);
    impl Drop for ComInit {
        fn drop(&mut self) {
            if self.0 {
                unsafe { CoUninitialize() };
            }
        }
    }
    thread_local! {
        static COM_INIT: ComInit = ComInit(unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED).is_ok() });
    }
    COM_INIT.with(|_| {});
}

#[neon::export(name = "GetAllSessions")]
fn get_all_sessions<'a>(cx: &mut FunctionContext<'a>) -> JsResult<'a, JsArray> {
    ensure_com();

    let (sessions, agile_master) = unsafe {
        let enumerator: IMMDeviceEnumerator =
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
                .or_else(|e| cx.throw_error(format!("COM error: {e}")))?;

        let device: IMMDevice = enumerator
            .GetDefaultAudioEndpoint(eRender, eMultimedia)
            .or_else(|e| cx.throw_error(format!("Audio endpoint error: {e}")))?;

        let master_volume: IAudioEndpointVolume = device
            .Activate(CLSCTX_INPROC_SERVER, None)
            .or_else(|e| cx.throw_error(format!("Master volume error: {e}")))?;

        let session_manager: IAudioSessionManager2 = device
            .Activate(CLSCTX_ALL, None)
            .or_else(|e| cx.throw_error(format!("Session manager error: {e}")))?;

        let session_enum = session_manager
            .GetSessionEnumerator()
            .or_else(|e| cx.throw_error(format!("Session enum error: {e}")))?;

        let count = session_enum
            .GetCount()
            .or_else(|e| cx.throw_error(format!("Count error: {e}")))?;

        let mut collected = Vec::new();

        for i in 0..count {
            if let Ok(sc) = session_enum.GetSession(i) {
                if let Ok(sc2) = sc.cast::<IAudioSessionControl2>() {
                    if let Ok(sav) = sc2.cast::<ISimpleAudioVolume>() {
                        let pid = sc2.GetProcessId().unwrap_or(0);
                        let path = get_process_path(pid);
                        collected.push((pid, path, AgileReference::new(&sav).unwrap()));
                    }
                }
            }
        }

        (collected, AgileReference::new(&master_volume).unwrap())
    };

    //
    // Create shared functions ONCE for this call
    //
    let fn_get_volume = JsFunction::new(cx, method_get_volume)?;
    let fn_set_volume = JsFunction::new(cx, method_set_volume)?;
    let fn_cleanup = JsFunction::new(cx, method_cleanup)?;

    let js_array = JsArray::new(cx, sessions.len() + 1);

    //
    // SESSIONS
    //
    for (i, (pid, path, agile_sav)) in sessions.into_iter().enumerate() {
        let obj = cx.empty_object();
        let pid_val = cx.number(pid as f64);
        obj.set(cx, "pid", pid_val)?;
        let path_val = cx.string(path);
        obj.set(cx, "path", path_val)?;

        let state = Arc::new(VolumeState {
            control: Mutex::new(Some(AgileVolumeControl::Session(agile_sav))),
        });
        let boxed_state = cx.boxed(state);
        obj.set(cx, "_state", boxed_state)?;
        obj.set(cx, "getVolume", fn_get_volume)?;
        obj.set(cx, "setVolume", fn_set_volume)?;
        obj.set(cx, "cleanup", fn_cleanup)?;

        js_array.set(cx, i as u32, obj)?;
    }

    //
    // MASTER
    //
    let master_obj = cx.empty_object();
    let pid_val = cx.number(0.0);
    master_obj.set(cx, "pid", pid_val)?;
    let path_val = cx.string("");
    master_obj.set(cx, "path", path_val)?;
    let master_val = cx.boolean(true);
    master_obj.set(cx, "master", master_val)?;

    let state = Arc::new(VolumeState {
        control: Mutex::new(Some(AgileVolumeControl::Master(agile_master))),
    });
    let boxed_state = cx.boxed(state);
    master_obj.set(cx, "_state", boxed_state)?;
    master_obj.set(cx, "getVolume", fn_get_volume)?;
    master_obj.set(cx, "setVolume", fn_set_volume)?;
    master_obj.set(cx, "cleanup", fn_cleanup)?;

    let last_index = (js_array.len(cx) - 1) as u32;
    js_array.set(cx, last_index, master_obj)?;

    Ok(js_array)
}

//
// =======================
// STUB
// =======================
//

#[neon::export(name = "GetProcessVolume")]
fn get_process_volume<'a>(cx: &mut FunctionContext<'a>) -> JsResult<'a, JsValue> {
    Ok(cx.null().upcast())
}
