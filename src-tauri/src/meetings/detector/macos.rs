//! macOS meeting detection: Core Audio device listeners + process list for mic capture.

use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use cidre::core_audio as ca;

use super::{AppInfo, SUSTAINED_POLL_SECS, score_app_for_meeting, spawn_polling_thread};

pub(super) fn is_system_app_for_display(app: &AppInfo) -> bool {
    let id = app.id.to_lowercase();
    let name = app.name.to_lowercase();
    id.starts_with("com.apple.") || name.contains("core speech") || name.contains("corespeechd")
}

/// True if bundle id or name looks like a helper/plugin subprocess (not the main app).
fn looks_like_helper(bundle_id: &str, name: &str) -> bool {
    let id = bundle_id.to_lowercase();
    let n = name.to_lowercase();
    n == "helper"
        || n.contains("renderer")
        || id.contains(".helper")
        || id.contains(".plugin")
        || id.ends_with(".renderer")
}

pub(super) fn list_mic_using_apps() -> Vec<AppInfo> {
    let Ok(processes) = ca::System::processes() else {
        eprintln!("[detector] Failed to get Core Audio processes");
        return Vec::new();
    };

    let mic_processes: Vec<(i32, Option<String>)> = processes
        .into_iter()
        .filter(|p| p.is_running_input().unwrap_or(false))
        .filter_map(|p| {
            let pid = p.pid().ok()? as i32;
            let bundle_id = p.bundle_id().ok().map(|b| b.to_string());
            Some((pid, bundle_id))
        })
        .collect();

    if mic_processes.is_empty() {
        return Vec::new();
    }

    // One sysinfo refresh so we can walk parent process tree for all PIDs.
    let sys = sysinfo::System::new_all();

    fn fallback_from_bundle_id(id: String) -> AppInfo {
        let name = id.rsplit('.').next().unwrap_or(&id).to_string();
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
            if p.extension()
                .and_then(|e| e.to_str())
                .is_some_and(|e| e.eq_ignore_ascii_case("app"))
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

    // Walk process tree upward via sysinfo; return first parent that resolves to a non-helper app.
    fn resolve_via_parent_process(pid: i32, sys: &sysinfo::System) -> Option<AppInfo> {
        use sysinfo::Pid;
        let mut current = Pid::from_u32(pid as u32);
        for _ in 0..15 {
            let proc = sys.process(current)?;
            let parent_pid = proc.parent()?;
            let parent_i32 = parent_pid.as_u32() as i32;
            if let Some(app) = resolve_pid_to_app(parent_i32) {
                if !looks_like_helper(&app.id, &app.name) {
                    return Some(app);
                }
            }
            current = parent_pid;
        }
        None
    }

    let mut apps: Vec<AppInfo> = mic_processes
        .into_iter()
        .filter_map(|(pid, bundle_id)| {
            let mut info = resolve_to_app(pid).or_else(|| {
                bundle_id
                    .as_ref()
                    .map(|b| fallback_from_bundle_id(b.clone()))
            })?;

            // If this process looks like a helper, try parent process walk first, then bundle truncation.
            if let Some(ref bid) = bundle_id {
                if looks_like_helper(bid, &info.name) {
                    if let Some(parent) = resolve_via_parent_process(pid, &sys) {
                        info = parent;
                    } else if let Some(parent) = resolve_parent_bundle(bid) {
                        info = parent;
                    }
                }
            }

            if info.id.to_lowercase().contains("lexi") {
                return None;
            }

            println!(
                "[detector] resolved PID {} -> {} ({})",
                pid, info.name, info.id
            );
            Some(info)
        })
        .collect();

    // Dedupe by bundle id (same app from multiple PIDs), then sort by meeting relevance (best first).
    let mut seen = std::collections::HashSet::new();
    apps.retain(|a| seen.insert(a.id.clone()));
    apps.sort_by(|a, b| score_app_for_meeting(b).cmp(&score_app_for_meeting(a)));
    apps
}

fn is_mic_running(device: &cidre::core_audio::Device) -> bool {
    device
        .prop::<u32>(&ca::PropSelector::DEVICE_IS_RUNNING_SOMEWHERE.global_addr())
        .map(|v| v != 0)
        .unwrap_or(false)
}

struct DetectorState {
    last_state: bool,
    last_change: Instant,
    debounce: Duration,
}

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

struct ListenerData {
    #[allow(dead_code)] // Only polling thread sends; listeners just update state
    tx: mpsc::Sender<Vec<AppInfo>>,
    state: Arc<Mutex<DetectorState>>,
    current_device: Arc<Mutex<Option<cidre::core_audio::Device>>>,
    device_listener_ptr: *mut (),
}

extern "C-unwind" fn device_listener(
    _obj_id: cidre::core_audio::Obj,
    number_addresses: u32,
    addresses: *const cidre::core_audio::PropAddr,
    client_data: *mut (),
) -> cidre::os::Status {
    let data = unsafe { &*(client_data as *const ListenerData) };
    let addresses = unsafe { std::slice::from_raw_parts(addresses, number_addresses as usize) };
    for addr in addresses {
        if addr.selector != ca::PropSelector::DEVICE_IS_RUNNING_SOMEWHERE {
            continue;
        }
        if let Ok(device) = ca::System::default_input_device() {
            let mic_in_use = is_mic_running(&device);
            println!(
                "[detector] device_listener called mic_in_use={}",
                mic_in_use
            );
            if let Ok(mut st) = data.state.lock() {
                let trigger = st.should_trigger(mic_in_use);
                // Don't send here — only polling emits, after SUSTAINED_POLL_SECS of continuous use.
                if trigger && mic_in_use {
                    let apps = list_mic_using_apps();
                    println!(
                        "[detector] device_listener mic on ({} app(s)); will emit after {}s sustained: {:?}",
                        apps.len(),
                        SUSTAINED_POLL_SECS,
                        apps.iter().map(|a| &a.name).collect::<Vec<_>>()
                    );
                }
            }
        }
        break;
    }
    cidre::os::Status::NO_ERR
}

extern "C-unwind" fn system_listener(
    _obj_id: cidre::core_audio::Obj,
    number_addresses: u32,
    addresses: *const cidre::core_audio::PropAddr,
    client_data: *mut (),
) -> cidre::os::Status {
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
                        // Don't send here — only polling emits after sustained use.
                        if let Ok(mut st) = data.state.lock() {
                            st.should_trigger(mic_in_use);
                        }
                    }
                }
            }
        }
        break;
    }
    cidre::os::Status::NO_ERR
}

pub(super) fn run_listener_thread(tx: mpsc::Sender<Vec<AppInfo>>) {
    println!("[detector] listener thread started (macOS)");
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
                let mic_in_use = data
                    .current_device
                    .lock()
                    .ok()
                    .and_then(|g| g.as_ref().map(is_mic_running))
                    .unwrap_or(false);
                println!(
                    "[detector] listener thread: initial mic_in_use={}",
                    mic_in_use
                );
                // Don't send on initial state — only polling emits after SUSTAINED_POLL_SECS.
                if let Ok(mut st) = data.state.lock() {
                    st.should_trigger(mic_in_use);
                }
            } else {
                eprintln!("[detector] listener thread: failed to add device listener");
            }
        }
        Err(e) => eprintln!(
            "[detector] listener thread: no default input device: {:?}",
            e
        ),
    }

    println!("[detector] listener thread: parked (listeners active)");
    std::thread::park();
}
