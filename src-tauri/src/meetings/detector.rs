// Meeting detection: when the default input device starts running (mic in use),
// we list which apps are using it and emit an event. Uses Core Audio property
// listeners; app list is resolved from processes with active input.

use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

use crate::state::{MeetingState, RoomState};

#[derive(Clone, Debug, serde::Serialize)]
pub struct MeetingContext {
    pub platform: String,
    pub title: String,
    pub confidence: f32,
}

#[derive(Clone, Debug)]
#[allow(dead_code)]
struct AppInfo {
    id: String,
    name: String,
}

#[cfg(target_os = "macos")]
fn list_mic_using_apps() -> Vec<AppInfo> {
    use std::path::{Path, PathBuf};

    use cidre::core_audio as ca;
    let Ok(processes) = ca::System::processes() else {
        return Vec::new();
    };

    fn fallback_from_bundle_id(id: String) -> AppInfo {
        let name = id
            .rsplit('.')
            .next()
            .unwrap_or(&id)
            .to_string();
        AppInfo { id, name }
    }

    fn resolve_via_sysinfo(pid: i32) -> Option<AppInfo> {
        use sysinfo::{Pid, System};
        let mut sys = System::new();
        let pid = Pid::from_u32(pid as u32);
        sys.refresh_processes(sysinfo::ProcessesToUpdate::Some(&[pid]), true);
        let exe_path = sys.process(pid)?.exe()?;
        let outer = find_outermost_app(exe_path)?;
        read_bundle_info(&outer)
    }

    fn find_outermost_app(path: &Path) -> Option<PathBuf> {
        let mut outermost: Option<&Path> = None;
        let mut cur = Some(path);
        while let Some(p) = cur {
            if p.extension().and_then(|e| e.to_str()).is_some_and(|e| e.eq_ignore_ascii_case("app"))
            {
                outermost = Some(p);
            }
            cur = p.parent();
        }
        outermost.map(|p| p.to_path_buf())
    }

    fn read_bundle_info(app_path: &Path) -> Option<AppInfo> {
        let info_plist = app_path.join("Contents").join("Info.plist");
        let value = plist::Value::from_file(info_plist).ok()?;
        let dict = value.as_dictionary()?;

        let id = dict
            .get("CFBundleIdentifier")
            .and_then(|v| v.as_string())
            .unwrap_or_default()
            .to_string();

        let name = dict
            .get("CFBundleDisplayName")
            .and_then(|v| v.as_string())
            .or_else(|| dict.get("CFBundleName").and_then(|v| v.as_string()))
            .map(|s| s.to_string())
            .or_else(|| {
                app_path
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .map(|s| s.to_string())
            })
            .unwrap_or_else(|| id.clone());

        if id.is_empty() {
            return None;
        }

        Some(AppInfo { id, name })
    }

    fn resolve_pid_to_app(pid: i32) -> Option<AppInfo> {
        use objc2_app_kit::NSRunningApplication;

        let app = NSRunningApplication::runningApplicationWithProcessIdentifier(pid)?;

        if let Some(bundle_url) = app.bundleURL() {
            if let Some(path_ns) = bundle_url.path() {
                let path_str = path_ns.to_string();
                if let Some(outer) = find_outermost_app(Path::new(&path_str)) {
                    if let Some(info) = read_bundle_info(&outer) {
                        return Some(info);
                    }
                }
            }
        }

        let id = app.bundleIdentifier()?.to_string();
        let name = app
            .localizedName()
            .map(|s| s.to_string())
            .unwrap_or_else(|| id.clone());
        Some(AppInfo { id, name })
    }

    fn resolve_via_bundle_id(bundle_id: &str) -> Option<AppInfo> {
        use objc2_app_kit::NSRunningApplication;
        use objc2_foundation::NSString;

        let ns_id = NSString::from_str(bundle_id);
        let running = NSRunningApplication::runningApplicationsWithBundleIdentifier(&ns_id);
        if running.count() == 0 {
            return None;
        }
        let first = running.objectAtIndex(0);

        if let Some(bundle_url) = first.bundleURL() {
            if let Some(path_ns) = bundle_url.path() {
                let path_str = path_ns.to_string();
                if let Some(outer) = find_outermost_app(Path::new(&path_str)) {
                    if let Some(info) = read_bundle_info(&outer) {
                        return Some(info);
                    }
                }
            }
        }

        let id = first.bundleIdentifier()?.to_string();
        let name = first
            .localizedName()
            .map(|s| s.to_string())
            .unwrap_or_else(|| id.clone());
        Some(AppInfo { id, name })
    }

    fn resolve_parent_bundle(bundle_id: &str) -> Option<AppInfo> {
        let parts: Vec<&str> = bundle_id.split('.').collect();
        if parts.len() < 3 {
            return None;
        }

        for i in (2..parts.len()).rev() {
            let candidate = parts[..i].join(".");
            if let Some(info) = resolve_via_bundle_id(&candidate) {
                return Some(info);
            }
        }
        None
    }

    fn resolve_to_app(pid: i32) -> Option<AppInfo> {
        let via_ns = std::panic::catch_unwind(|| resolve_pid_to_app(pid))
            .ok()
            .flatten();
        via_ns.or_else(|| resolve_via_sysinfo(pid))
    }

    processes
        .into_iter()
        .filter(|p| p.is_running_input().unwrap_or(false))
        .filter_map(|p| {
            let pid = p.pid().ok()? as i32;
            let bundle_id = p.bundle_id().ok().map(|b| b.to_string());

            let mut info = resolve_to_app(pid).or_else(|| {
                bundle_id
                    .clone()
                    .map(fallback_from_bundle_id)
            })?;

            // If the mic-using process is a helper subprocess, try to resolve it back to the
            // parent running app (e.g. com.google.Chrome.helper -> com.google.Chrome).
            if let Some(bid) = bundle_id.as_deref() {
                if info.name.eq_ignore_ascii_case("helper") || bid.contains(".helper") {
                    if let Some(parent) = resolve_parent_bundle(bid) {
                        info = parent;
                    }
                }
            }

            if info.id.to_lowercase().contains("lexi") {
                return None;
            }

            Some(info)
        })
        .collect()
}

#[cfg(not(target_os = "macos"))]
fn list_mic_using_apps() -> Vec<AppInfo> {
    Vec::new()
}

#[cfg(target_os = "macos")]
fn spawn_polling_thread(tx: mpsc::Sender<Vec<AppInfo>>) {
    use std::collections::HashSet;
    std::thread::spawn(move || {
        let mut last_ids: HashSet<String> = HashSet::new();
        loop {
            std::thread::sleep(Duration::from_secs(1));
            let apps = list_mic_using_apps();
            let ids: HashSet<String> = apps.iter().map(|a| a.id.clone()).collect();

            if ids == last_ids {
                continue;
            }
            last_ids = ids;

            println!(
                "[detector] polling saw {} app(s): {:?}",
                apps.len(),
                apps.iter().map(|a| &a.name).collect::<Vec<_>>()
            );

            if !apps.is_empty() {
                let _ = tx.send(apps);
            }
        }
    });
}

#[cfg(target_os = "macos")]
fn is_mic_running(device: &cidre::core_audio::Device) -> bool {
    use cidre::core_audio as ca;
    device
        .prop::<u32>(&ca::PropSelector::DEVICE_IS_RUNNING_SOMEWHERE.global_addr())
        .map(|v| v != 0)
        .unwrap_or(false)
}

#[cfg(target_os = "macos")]
struct DetectorState {
    last_state: bool,
    last_change: Instant,
    debounce: Duration,
}

#[cfg(target_os = "macos")]
impl DetectorState {
    fn new() -> Self {
        Self {
            last_state: false,
            last_change: Instant::now(),
            debounce: Duration::from_millis(500),
        }
    }
    fn should_trigger(&mut self, new_state: bool) -> bool {
        if new_state == self.last_state {
            return false;
        }
        if Instant::now().duration_since(self.last_change) < self.debounce {
            return false;
        }
        self.last_state = new_state;
        self.last_change = Instant::now();
        true
    }
}

#[cfg(target_os = "macos")]
struct ListenerData {
    tx: mpsc::Sender<Vec<AppInfo>>,
    state: Arc<Mutex<DetectorState>>,
    current_device: Arc<Mutex<Option<cidre::core_audio::Device>>>,
    device_listener_ptr: *mut (),
}

#[cfg(target_os = "macos")]
extern "C-unwind" fn device_listener(
    _obj_id: cidre::core_audio::Obj,
    number_addresses: u32,
    addresses: *const cidre::core_audio::PropAddr,
    client_data: *mut (),
) -> cidre::os::Status {
    use cidre::core_audio as ca;
    let data = unsafe { &*(client_data as *const ListenerData) };
    let addresses = unsafe { std::slice::from_raw_parts(addresses, number_addresses as usize) };
    for addr in addresses {
        if addr.selector != ca::PropSelector::DEVICE_IS_RUNNING_SOMEWHERE {
            continue;
        }
        if let Ok(device) = ca::System::default_input_device() {
            let mic_in_use = is_mic_running(&device);
            println!("[detector] device_listener called mic_in_use={}", mic_in_use);
            if let Ok(mut st) = data.state.lock() {
                let trigger = st.should_trigger(mic_in_use);
                if trigger && mic_in_use {
                    let apps = list_mic_using_apps();
                    println!("[detector] device_listener sending {} app(s): {:?}", apps.len(), apps.iter().map(|a| &a.name).collect::<Vec<_>>());
                    let _ = data.tx.send(apps);
                }
            }
        }
        break;
    }
    cidre::os::Status::NO_ERR
}

#[cfg(target_os = "macos")]
extern "C-unwind" fn system_listener(
    _obj_id: cidre::core_audio::Obj,
    number_addresses: u32,
    addresses: *const cidre::core_audio::PropAddr,
    client_data: *mut (),
) -> cidre::os::Status {
    use cidre::core_audio as ca;
    const DEVICE_IS_RUNNING_SOMEWHERE: ca::PropAddr = ca::PropAddr {
        selector: ca::PropSelector::DEVICE_IS_RUNNING_SOMEWHERE,
        scope: ca::PropScope::GLOBAL,
        element: ca::PropElement::MAIN,
    };
    let data = unsafe { &*(client_data as *const ListenerData) };
    let addresses = unsafe { std::slice::from_raw_parts(addresses, number_addresses as usize) };
    for addr in addresses {
        if addr.selector != ca::PropSelector::HW_DEFAULT_INPUT_DEVICE {
            continue;
        }
        if let Ok(mut guard) = data.current_device.lock() {
            if let Some(old) = guard.take() {
                let _ = old.remove_prop_listener(
                    &DEVICE_IS_RUNNING_SOMEWHERE,
                    device_listener,
                    data.device_listener_ptr,
                );
            }
        }
        if let Ok(device) = ca::System::default_input_device() {
            if device
                .add_prop_listener(
                    &DEVICE_IS_RUNNING_SOMEWHERE,
                    device_listener,
                    data.device_listener_ptr,
                )
                .is_ok()
            {
                if let Ok(mut guard) = data.current_device.lock() {
                    *guard = Some(device);
                }
                if let Ok(device_guard) = data.current_device.lock() {
                    if let Some(ref dev) = *device_guard {
                        let mic_in_use = is_mic_running(dev);
                        if let Ok(mut st) = data.state.lock() {
                            if st.should_trigger(mic_in_use) && mic_in_use {
                                let apps = list_mic_using_apps();
                                let _ = data.tx.send(apps);
                            }
                        }
                    }
                }
            }
        }
        break;
    }
    cidre::os::Status::NO_ERR
}

#[cfg(target_os = "macos")]
fn run_listener_thread(tx: mpsc::Sender<Vec<AppInfo>>) {
    println!("[detector] listener thread started (macOS)");
    use cidre::core_audio as ca;
    const DEVICE_IS_RUNNING_SOMEWHERE: ca::PropAddr = ca::PropAddr {
        selector: ca::PropSelector::DEVICE_IS_RUNNING_SOMEWHERE,
        scope: ca::PropScope::GLOBAL,
        element: ca::PropElement::MAIN,
    };
    let state = Arc::new(Mutex::new(DetectorState::new()));
    let current_device = Arc::new(Mutex::new(None));

    spawn_polling_thread(tx.clone());

    let device_data = Box::new(ListenerData {
        tx: tx.clone(),
        state: state.clone(),
        current_device: current_device.clone(),
        device_listener_ptr: std::ptr::null_mut(),
    });
    let device_listener_ptr = Box::into_raw(device_data) as *mut ();

    let system_data = Box::new(ListenerData {
        tx,
        state,
        current_device,
        device_listener_ptr,
    });
    let system_listener_ptr = Box::into_raw(system_data) as *mut ();

    if ca::System::OBJ
        .add_prop_listener(
            &ca::PropSelector::HW_DEFAULT_INPUT_DEVICE.global_addr(),
            system_listener,
            system_listener_ptr,
        )
        .is_err()
    {
        eprintln!("[detector] failed to add system listener");
        unsafe { drop(Box::from_raw(system_listener_ptr as *mut ListenerData)) };
        return;
    }
    println!("[detector] listener thread: system listener added");

    match ca::System::default_input_device() {
        Ok(device) => {
            if device
                .add_prop_listener(
                    &DEVICE_IS_RUNNING_SOMEWHERE,
                    device_listener,
                    device_listener_ptr,
                )
                .is_ok()
            {
                println!("[detector] listener thread: device listener added");
                if let Ok(mut guard) = (unsafe { &*(system_listener_ptr as *const ListenerData) })
                    .current_device
                    .lock()
                {
                    *guard = Some(device);
                }
                let data = unsafe { &*(system_listener_ptr as *const ListenerData) };
                let mic_in_use = data.current_device.lock().ok().and_then(|g| g.as_ref().map(is_mic_running)).unwrap_or(false);
                println!("[detector] listener thread: initial mic_in_use={}", mic_in_use);
                if let Ok(mut st) = data.state.lock() {
                    if st.should_trigger(mic_in_use) && mic_in_use {
                        let apps = list_mic_using_apps();
                        println!("[detector] listener thread: initial send {} app(s): {:?}", apps.len(), apps.iter().map(|a| &a.name).collect::<Vec<_>>());
                        let _ = data.tx.send(apps);
                    }
                }
            } else {
                eprintln!("[detector] listener thread: failed to add device listener");
            }
        }
        Err(e) => eprintln!("[detector] listener thread: no default input device: {:?}", e),
    }

    println!("[detector] listener thread: parked (listeners active)");
    std::thread::park();
}

pub fn start_meeting_detector(app_handle: AppHandle) {
    println!("[detector] start_meeting_detector called");
    let (tx_std, rx_std) = mpsc::channel::<Vec<AppInfo>>();
    let (tx_tokio, mut rx_tokio) = tokio::sync::mpsc::channel::<Vec<AppInfo>>(8);

    std::thread::spawn(move || {
        while let Ok(apps) = rx_std.recv() {
            if tx_tokio.blocking_send(apps).is_err() {
                break;
            }
        }
    });

    #[cfg(target_os = "macos")]
    std::thread::spawn(move || run_listener_thread(tx_std));

    tauri::async_runtime::spawn(async move {
        let mut in_cooldown_until = tokio::time::Instant::now();
        let cooldown_duration = Duration::from_secs(5 * 60);

        while let Some(apps) = rx_tokio.recv().await {
                println!("[detector] async received {} app(s)", apps.len());
                if apps.is_empty() {
                    continue;
                }

                let mut skip = false;
                if let Some(room_state) = app_handle.try_state::<RoomState>() {
                    if let Ok(guard) = room_state.is_recording.try_lock() {
                        if *guard {
                            skip = true;
                        }
                    }
                }
                if !skip {
                    if let Some(meeting_state) = app_handle.try_state::<MeetingState>() {
                        if let Ok(guard) = meeting_state.is_recording.try_lock() {
                            if *guard {
                                skip = true;
                            }
                        }
                    }
                }
                if skip {
                    println!("[detector] skip: already recording");
                    continue;
                }
                if tokio::time::Instant::now() < in_cooldown_until {
                    println!("[detector] skip: cooldown");
                    continue;
                }

                let platform = apps.first().map(|a| a.name.clone()).unwrap_or_else(|| "Meeting".to_string());
                let context = MeetingContext {
                    platform,
                    title: String::new(),
                    confidence: 0.9,
                };
                println!("Meeting detected: app={}", context.platform);
                tokio::time::sleep(Duration::from_secs(1)).await;
                let _ = app_handle.emit("meeting-detected", context);
                in_cooldown_until = tokio::time::Instant::now() + cooldown_duration;
        }
    });
}
