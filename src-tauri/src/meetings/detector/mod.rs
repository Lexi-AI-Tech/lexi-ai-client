// Meeting detection: when the default input is in use, list which apps hold capture sessions
// and emit an event. macOS: Core Audio + process list; Windows: WASAPI session enumeration.

#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "windows")]
mod win;

use std::collections::HashMap;
use std::sync::mpsc;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

use crate::state::MeetingState;
#[cfg(any(target_os = "macos", target_os = "windows"))]
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
pub(super) struct AppInfo {
    id: String,
    name: String,
}

fn is_system_app_for_display(app: &AppInfo) -> bool {
    #[cfg(target_os = "macos")]
    {
        return macos::is_system_app_for_display(app);
    }
    #[cfg(target_os = "windows")]
    {
        return win::is_system_app_for_display(app);
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = app;
        false
    }
}

pub(super) fn is_lexi_app(app: &AppInfo) -> bool {
    app.id.to_lowercase().contains("lexi")
}

/// Non-system mic users other than Lexi (e.g. Zoom, Chrome). When this count hits zero after being positive during recording, the external call likely ended.
fn count_non_lexi_mic_users(apps: &[AppInfo]) -> usize {
    apps.iter()
        .filter(|a| !is_system_app_for_display(a) && !is_lexi_app(a))
        .count()
}

/// Score how "meeting-like" an app is; higher = more likely a real meeting app.
pub(super) fn score_app_for_meeting(app: &AppInfo) -> i32 {
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

fn list_mic_using_apps() -> Vec<AppInfo> {
    #[cfg(target_os = "macos")]
    {
        return macos::list_mic_using_apps();
    }
    #[cfg(target_os = "windows")]
    {
        return win::list_mic_using_apps();
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        Vec::new()
    }
}

/// Emit meeting-detected only after this many consecutive seconds of mic use (1 poll/sec).
#[cfg(any(target_os = "macos", target_os = "windows"))]
const SUSTAINED_POLL_SECS: u32 = 2;

#[cfg(any(target_os = "macos", target_os = "windows"))]
pub(super) fn spawn_polling_thread(tx: mpsc::Sender<Vec<AppInfo>>) {
    use std::collections::HashSet;
    std::thread::spawn(move || {
        #[cfg(target_os = "windows")]
        unsafe {
            let _ = windows::Win32::System::Com::CoInitializeEx(
                None,
                windows::Win32::System::Com::COINIT_MULTITHREADED,
            );
        }
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
    std::thread::spawn(move || macos::run_listener_thread(tx_std));

    #[cfg(target_os = "windows")]
    std::thread::spawn(move || win::run_detector_thread(tx_std));

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let _ = tx_std;

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
            if let Some(meeting_state) = app_detect.try_state::<MeetingState>() {
                if let Ok(guard) = meeting_state.is_recording.try_lock() {
                    if *guard {
                        skip = true;
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
            #[cfg(any(target_os = "macos", target_os = "windows"))]
            let frontmost_name =
                crate::cursor_context::get_frontmost_application_name().unwrap_or_default();
            #[cfg(not(any(target_os = "macos", target_os = "windows")))]
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
    #[cfg(any(target_os = "macos", target_os = "windows"))]
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
