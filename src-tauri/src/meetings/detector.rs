// Meeting detection: when the default input device starts running (mic in use),
// we list which apps are using it and emit an event. Uses Core Audio property
// listeners; app list is resolved from processes with active input.

use std::collections::HashMap;
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

use crate::state::{MeetingState, RoomState};
use crate::window::show_and_focus_main_window;

#[derive(Clone, Debug, serde::Serialize)]
pub struct MeetingContext {
    pub platform: String,
}

/// Emitted when Lexi is recording but other apps (e.g. Zoom) no longer use the mic — user may have left the call.
#[derive(Clone, Debug, serde::Serialize)]
pub struct MeetingMicEndedPayload {
    #[serde(rename = "meetingId")]
    pub meeting_id: String,
}

#[derive(Clone, Debug)]
#[allow(dead_code)]
struct AppInfo {
    id: String,
    name: String,
}

/// True if this app should be treated as system/OS for display (e.g. Core Speech when Chrome uses mic).
fn is_system_app_for_display(app: &AppInfo) -> bool {
    let id = app.id.to_lowercase();
    let name = app.name.to_lowercase();
    id.starts_with("com.apple.") || name.contains("core speech") || name.contains("corespeechd")
}

fn is_lexi_app(app: &AppInfo) -> bool {
    app.id.to_lowercase().contains("lexi")
}

/// Non-system mic users other than Lexi (e.g. Zoom, Chrome). When this count hits zero after being positive during recording, the external call likely ended.
fn count_non_lexi_mic_users(apps: &[AppInfo]) -> usize {
    apps
        .iter()
        .filter(|a| !is_system_app_for_display(a) && !is_lexi_app(a))
        .count()
}

/// Score how "meeting-like" an app is; higher = more likely a real meeting app.
fn score_app_for_meeting(app: &AppInfo) -> i32 {
    let name = app.name.to_lowercase();
    let id = app.id.to_lowercase();
    if id.contains("zoom") || name.contains("zoom") {
        return 10;
    }
    if id.contains("microsoft.teams") || name.contains("teams") {
        return 10;
    }
    if id.contains("tinyspeck.slack") || name.contains("slack") {
        return 8;
    }
    if id.contains("cisco.webex") || name.contains("webex") {
        return 8;
    }
    if id.contains("bluejeans") || name.contains("bluejeans") {
        return 7;
    }
    if id.contains("gotomeeting") || name.contains("go to meeting") {
        return 7;
    }
    if id.contains("discord") || name.contains("discord") {
        return 6;
    }
    // Chrome/Safari with Meet or similar: often just "Google Chrome" when in Meet
    if (id.contains("google.chrome") || id.contains("apple.safari"))
        && (name.contains("chrome") || name.contains("safari"))
    {
        return 3;
    }
    // Generic browser with no meeting hints: low score so known meeting apps win
    if name.contains("chrome")
        || name.contains("safari")
        || name.contains("firefox")
        || name.contains("edge")
    {
        return 1;
    }
    // Unknown app: neutral
    5
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

#[cfg(target_os = "macos")]
fn list_mic_using_apps() -> Vec<AppInfo> {
    use std::path::{Path, PathBuf};

    use cidre::core_audio as ca;
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

#[cfg(not(target_os = "macos"))]
fn list_mic_using_apps() -> Vec<AppInfo> {
    Vec::new()
}

/// Emit meeting-detected only after this many consecutive seconds of mic use (1 poll/sec).
#[cfg(target_os = "macos")]
const SUSTAINED_POLL_SECS: u32 = 2;

#[cfg(target_os = "macos")]
fn spawn_polling_thread(tx: mpsc::Sender<Vec<AppInfo>>) {
    use std::collections::HashSet;
    std::thread::spawn(move || {
        let mut last_ids: HashSet<String> = HashSet::new();
        let mut consecutive_same: u32 = 0;
        let mut last_sent_ids: Option<HashSet<String>> = None;
        loop {
            std::thread::sleep(Duration::from_secs(1));
            let apps = list_mic_using_apps();
            let ids: HashSet<String> = apps.iter().map(|a| a.id.clone()).collect();

            if ids.is_empty() {
                last_sent_ids = None;
                last_ids.clear();
                consecutive_same = 0;
                continue;
            }

            if ids != last_ids {
                last_ids = ids.clone();
                consecutive_same = 0;
            }
            consecutive_same += 1;

            // Already sent for this app set (cooldown is handled by async handler).
            if last_sent_ids.as_ref() == Some(&ids) {
                continue;
            }
            if consecutive_same < SUSTAINED_POLL_SECS {
                continue;
            }

            println!(
                "[detector] polling: {} app(s) for {}s — emitting: {:?}",
                apps.len(),
                consecutive_same,
                apps.iter().map(|a| &a.name).collect::<Vec<_>>()
            );
            let _ = tx.send(apps);
            last_sent_ids = Some(ids);
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
    #[allow(dead_code)] // Only polling thread sends; listeners just update state
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

    let app_detect = app_handle.clone();
    tauri::async_runtime::spawn(async move {
        let mut cooldown_until_by_app: HashMap<String, tokio::time::Instant> = HashMap::new();
        let cooldown_duration = Duration::from_secs(10 * 60); // 10 minutes per app

        while let Some(apps) = rx_tokio.recv().await {
            println!("[detector] async received {} app(s)", apps.len());
            if apps.is_empty() {
                continue;
            }

            let mut skip = false;
            if let Some(room_state) = app_detect.try_state::<RoomState>() {
                if let Ok(guard) = room_state.is_recording.try_lock() {
                    if *guard {
                        skip = true;
                    }
                }
            }
            if !skip {
                if let Some(meeting_state) = app_detect.try_state::<MeetingState>() {
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

            // Exclude system processes (e.g. Core Speech).
            let candidate_apps: Vec<&AppInfo> = apps
                .iter()
                .filter(|a| !is_system_app_for_display(a))
                .collect();
            // Use only the frontmost app to decide where the meeting is: emit only if the focused
            // app is in the mic-using list.
            #[cfg(target_os = "macos")]
            let frontmost_name = crate::cursor_context::get_cursor_context()
                .and_then(|c| c.app_name)
                .unwrap_or_default();
            #[cfg(not(target_os = "macos"))]
            let frontmost_name = String::new();
            let Some(best_app) = candidate_apps
                .iter()
                .find(|a| a.name.eq_ignore_ascii_case(&frontmost_name))
                .copied()
            else {
                continue;
            };
            if best_app.id.to_lowercase().contains("lexi") {
                println!("[detector] skip: best app is Lexi");
                continue;
            }
            let app_id = best_app.id.clone();
            // Use the app's display name (from plist, same kind of source as cursor context).
            let platform = best_app.name.clone();

            // Per-app cooldown: only skip if this app was recently shown.
            let now = tokio::time::Instant::now();
            if let Some(&until) = cooldown_until_by_app.get(&app_id) {
                if now < until {
                    println!("[detector] skip: cooldown for app {}", app_id);
                    continue;
                }
                cooldown_until_by_app.remove(&app_id);
            }

            let context = MeetingContext {
                platform: platform.clone(),
            };
            println!("Meeting detected: app={}", context.platform);
            tokio::time::sleep(Duration::from_secs(1)).await;
            let _ = app_detect.emit("meeting-detected", context);
            cooldown_until_by_app.insert(app_id, now + cooldown_duration);
        }
    });

    // While a meeting recording is active, detect when other apps stop using the mic (call likely ended).
    #[cfg(target_os = "macos")]
    {
        tauri::async_runtime::spawn(async move {
            use tokio::time::{interval, Duration as TokioDuration};
            let mut tick = interval(TokioDuration::from_secs(1));
            let mut saw_non_lexi_mic = false;
            let mut consecutive_only_lexi = 0u32;
            let sustained_ticks = 2; // 2 consecutive checks at 1s interval
            let mut last_emit: Option<std::time::Instant> = None;
            let emit_cooldown = Duration::from_secs(120);

            loop {
                tick.tick().await;

                let skip_room = app_handle
                    .try_state::<RoomState>()
                    .map(|rs| *rs.is_recording.lock().unwrap())
                    .unwrap_or(false);
                if skip_room {
                    saw_non_lexi_mic = false;
                    consecutive_only_lexi = 0;
                    continue;
                }

                let (recording, meeting_id) = match app_handle.try_state::<MeetingState>() {
                    Some(ms) => {
                        let rec = *ms.is_recording.lock().unwrap();
                        let id = ms.current_meeting_id.lock().unwrap().clone();
                        (rec, id)
                    }
                    None => (false, None),
                };

                if !recording {
                    saw_non_lexi_mic = false;
                    consecutive_only_lexi = 0;
                    continue;
                }

                let Some(mid) = meeting_id else {
                    saw_non_lexi_mic = false;
                    consecutive_only_lexi = 0;
                    continue;
                };

                let apps = match tokio::task::spawn_blocking(|| list_mic_using_apps()).await {
                    Ok(a) => a,
                    Err(_) => continue,
                };

                let external = count_non_lexi_mic_users(&apps);
                if external > 0 {
                    saw_non_lexi_mic = true;
                    consecutive_only_lexi = 0;
                    continue;
                }

                if saw_non_lexi_mic {
                    consecutive_only_lexi += 1;
                    if consecutive_only_lexi >= sustained_ticks {
                        let now_std = std::time::Instant::now();
                        let cooled = last_emit
                            .map(|t| now_std.duration_since(t) >= emit_cooldown)
                            .unwrap_or(true);
                        if cooled {
                            let still = app_handle.try_state::<MeetingState>().map(|ms| {
                                let rec = *ms.is_recording.lock().unwrap();
                                let cur = ms.current_meeting_id.lock().unwrap().clone();
                                rec && cur.as_deref() == Some(mid.as_str())
                            });
                            if still != Some(true) {
                                saw_non_lexi_mic = false;
                                consecutive_only_lexi = 0;
                                continue;
                            }
                            println!(
                                "[detector] recording mic watcher: external apps gone, emit meeting-mic-ended meeting_id={}",
                                mid
                            );
                            if let Some(ms) = app_handle.try_state::<MeetingState>() {
                                *ms.pending_mic_ended_meeting_id.lock().unwrap() =
                                    Some(mid.clone());
                            }
                            show_and_focus_main_window(&app_handle);
                            let payload = MeetingMicEndedPayload {
                                meeting_id: mid.clone(),
                            };
                            let _ = app_handle.emit("meeting-mic-ended", payload);
                            last_emit = Some(now_std);
                            saw_non_lexi_mic = false;
                            consecutive_only_lexi = 0;
                        }
                    }
                }
            }
        });
    }
}
