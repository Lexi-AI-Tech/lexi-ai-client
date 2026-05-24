//! Windows meeting detection: WASAPI capture session enumeration.

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use windows::core::{ComInterface, HSTRING, PCWSTR, PWSTR};
use windows::w;
use windows::Win32::Foundation::{CloseHandle, MAX_PATH};
use windows::Win32::Media::Audio::{
    eCapture, eConsole, AudioSessionStateActive, IAudioSessionControl2, IAudioSessionManager2,
    IMMDeviceEnumerator, MMDeviceEnumerator,
};
use windows::Win32::Storage::FileSystem::{
    GetFileVersionInfoSizeW, GetFileVersionInfoW, VerQueryValueW,
};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED,
};
use windows::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
};

use super::{score_app_for_meeting, AppInfo};

pub(super) fn is_system_app_for_display(app: &AppInfo) -> bool {
    let id = app.id.to_lowercase();
    let name = app.name.to_lowercase();
    id.contains("speechmodeling")
        || id.contains("speechruntime")
        || id.contains("textinputhost.exe")
        || name.contains("windows speech")
        || name.contains("speech recognition")
        || name.contains("voice access")
}

#[repr(C)]
struct LangCodePage {
    w_language: u16,
    w_code_page: u16,
}

fn get_process_path(pid: u32) -> Option<PathBuf> {
    unsafe {
        let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut len: u32 = MAX_PATH;
        let mut buf = vec![0u16; MAX_PATH as usize];
        let pw = PWSTR::from_raw(buf.as_mut_ptr());
        let ok = QueryFullProcessImageNameW(h, PROCESS_NAME_WIN32, pw, &mut len).as_bool();
        let _ = CloseHandle(h);
        if !ok {
            return None;
        }
        let s = pw.to_string().ok()?;
        Some(PathBuf::from(s))
    }
}

fn get_file_description(process_path: &Path) -> Option<String> {
    let process_path_hstring: HSTRING = process_path.as_os_str().into();
    let info_size = unsafe { GetFileVersionInfoSizeW(&process_path_hstring, None) };
    if info_size == 0 {
        return None;
    }
    let mut file_version_info = vec![0u8; info_size as usize];
    if !unsafe {
        GetFileVersionInfoW(
            &process_path_hstring,
            0,
            info_size,
            file_version_info.as_mut_ptr().cast(),
        )
    }
    .as_bool()
    {
        return None;
    }
    let mut lang_ptr = std::ptr::null_mut();
    let mut len = 0;
    if !unsafe {
        VerQueryValueW(
            file_version_info.as_ptr().cast(),
            w!("\\VarFileInfo\\Translation"),
            &mut lang_ptr,
            &mut len,
        )
    }
    .as_bool()
    {
        return None;
    }
    if len < std::mem::size_of::<LangCodePage>() as u32 {
        return None;
    }
    let lang: &[LangCodePage] =
        unsafe { std::slice::from_raw_parts(lang_ptr as *const LangCodePage, 1) };
    let lang = lang.first()?;
    let lang_code = format!(
        "\\StringFileInfo\\{:04x}{:04x}\\FileDescription",
        lang.w_language, lang.w_code_page
    );
    let lang_code = PCWSTR(HSTRING::from(&lang_code).as_wide().as_ptr());
    let mut file_description_ptr = std::ptr::null_mut();
    let mut query_len: u32 = 0;
    if !unsafe {
        VerQueryValueW(
            file_version_info.as_ptr().cast(),
            lang_code,
            &mut file_description_ptr,
            &mut query_len,
        )
    }
    .as_bool()
    {
        return None;
    }
    if query_len == 0 {
        return None;
    }
    let file_description =
        unsafe { std::slice::from_raw_parts(file_description_ptr.cast(), query_len as usize) };
    let file_description = String::from_utf16_lossy(file_description);
    let trimmed = file_description
        .trim_matches(char::from(0))
        .trim()
        .to_owned();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed)
    }
}

/// Match `active-win-pos-rs` / `get_frontmost_application_name`: FileDescription, else exe stem.
fn display_name_for_exe(path: &Path) -> String {
    if let Some(desc) = get_file_description(path) {
        return desc;
    }
    path.file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_owned()
}

pub(super) fn list_mic_using_apps() -> Vec<AppInfo> {
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
    }

    let enumerator = unsafe {
        CoCreateInstance::<_, IMMDeviceEnumerator>(&MMDeviceEnumerator, None, CLSCTX_ALL)
    };
    let enumerator = match enumerator {
        Ok(e) => e,
        Err(e) => {
            eprintln!("[detector] MMDeviceEnumerator: {:?}", e);
            return Vec::new();
        }
    };

    let device = unsafe { enumerator.GetDefaultAudioEndpoint(eCapture, eConsole) };
    let device = match device {
        Ok(d) => d,
        Err(e) => {
            eprintln!("[detector] GetDefaultAudioEndpoint capture: {:?}", e);
            return Vec::new();
        }
    };

    let mgr = unsafe { device.Activate::<IAudioSessionManager2>(CLSCTX_ALL, None) };
    let mgr = match mgr {
        Ok(m) => m,
        Err(e) => {
            eprintln!("[detector] Activate IAudioSessionManager2: {:?}", e);
            return Vec::new();
        }
    };

    let sessions = unsafe { mgr.GetSessionEnumerator() };
    let sessions = match sessions {
        Ok(s) => s,
        Err(e) => {
            eprintln!("[detector] GetSessionEnumerator: {:?}", e);
            return Vec::new();
        }
    };

    let count = match unsafe { sessions.GetCount() } {
        Ok(c) => c,
        Err(e) => {
            eprintln!("[detector] GetCount sessions: {:?}", e);
            return Vec::new();
        }
    };

    let mut pids: HashSet<u32> = HashSet::new();
    for i in 0..count {
        let session = unsafe { sessions.GetSession(i) };
        let session = match session {
            Ok(s) => s,
            Err(_) => continue,
        };
        let state = unsafe { session.GetState() };
        let state = match state {
            Ok(s) => s,
            Err(_) => continue,
        };
        if state != AudioSessionStateActive {
            continue;
        }
        let c2: IAudioSessionControl2 = match session.cast() {
            Ok(c) => c,
            Err(_) => continue,
        };
        let pid = match unsafe { c2.GetProcessId() } {
            Ok(p) if p > 0 => p,
            _ => continue,
        };
        pids.insert(pid);
    }

    let mut apps: Vec<AppInfo> = Vec::new();
    for pid in pids {
        let Some(path) = get_process_path(pid) else {
            continue;
        };
        let path_lower = path.to_string_lossy().to_lowercase();
        let name = display_name_for_exe(&path);
        let id = path_lower.clone();

        let app = AppInfo { id, name };
        if is_system_app_for_display(&app) || super::is_lexi_app(&app) {
            continue;
        }
        println!(
            "[detector] resolved PID {} -> {} ({})",
            pid,
            app.name,
            path.display()
        );
        apps.push(app);
    }

    let mut seen = HashSet::new();
    apps.retain(|a| seen.insert(a.id.clone()));
    apps.sort_by(|a, b| score_app_for_meeting(b).cmp(&score_app_for_meeting(a)));
    apps
}

pub(super) fn run_detector_thread(tx: std::sync::mpsc::Sender<Vec<AppInfo>>) {
    println!("[detector] listener thread started (Windows)");
    super::spawn_polling_thread(tx);
}
