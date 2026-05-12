//! Windows Native Low-Level Keyboard Hook Listener
//!
//! Uses Win32 `SetWindowsHookExW` with `WH_KEYBOARD_LL` to capture global keyboard events.
//! This is the standard, reliable approach for system-wide hotkey detection on Windows.

#![cfg(target_os = "windows")]

use crate::RecordingCommand;
use std::sync::{mpsc, Arc, Mutex};
use tauri::{AppHandle, Emitter};
use tokio::sync::watch;

use super::{key_to_string, HotkeyCommandResult, Key, KeyStateTracker};

use winapi::shared::minwindef::{LPARAM, LRESULT, WPARAM};
use winapi::um::libloaderapi::GetModuleHandleW;
use winapi::um::debugapi::OutputDebugStringW;
use winapi::um::winuser::{
    CallNextHookEx, DispatchMessageW, GetMessageW, SetWindowsHookExW, UnhookWindowsHookEx,
    GetAsyncKeyState, KBDLLHOOKSTRUCT, MSG, PeekMessageW, VK_LMENU, VK_LWIN, VK_MENU, VK_RMENU,
    VK_RWIN, VK_SHIFT, WH_KEYBOARD_LL, WM_KEYDOWN, WM_KEYUP, WM_SYSKEYDOWN, WM_SYSKEYUP,
    PM_NOREMOVE,
};

use lazy_static::lazy_static;
use std::ptr::null_mut;
use std::ffi::OsStr;
use std::os::windows::ffi::OsStrExt;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

// ============================================================================
// Global State for the Hook Callback
// ============================================================================

use super::normalize_key_string_common;
use super::GlobalKeyListenerContext;

lazy_static! {
    static ref GLOBAL_STATE: Mutex<Option<WindowsGlobalKeyListenerState>> = Mutex::new(None);
}

/// Updated whenever the low-level hook callback fires.
/// If this stops advancing (e.g. app focused case), we switch to a polling fallback.
static LAST_HOOK_EPOCH_MS: AtomicU64 = AtomicU64::new(0);

struct WindowsGlobalKeyListenerState {
    context: GlobalKeyListenerContext,
}

/// Windows-specific key name normalization.
///
/// We keep the canonical name `"Windows"` (not `"Command"`) so onboarding defaults like
/// `Control+Windows` match what the listener emits.
pub(crate) fn normalize_key_string_platform(key: &str) -> String {
    let k = key.trim().to_lowercase();
    match k.as_str() {
        "win" | "windows" | "lwin" | "rwin" => "Windows".to_string(),
        // Accept "command" as an alias on Windows for backward compatibility with older stored configs.
        "cmd" | "command" | "meta" | "super" => "Windows".to_string(),
        _ => normalize_key_string_common(key),
    }
}

// Required because AppHandle is Send+Sync but the mutex wrapper needs explicit marking
unsafe impl Send for WindowsGlobalKeyListenerState {}
unsafe impl Sync for WindowsGlobalKeyListenerState {}

// ============================================================================
// Virtual Key Code to Internal Key Mapping
// ============================================================================

/// Convert Windows virtual key code (vkCode) to our internal Key enum
fn vk_to_key(vk: u32) -> Key {
    match vk {
        // Letters A-Z (0x41-0x5A)
        0x41 => Key::KeyA,
        0x42 => Key::KeyB,
        0x43 => Key::KeyC,
        0x44 => Key::KeyD,
        0x45 => Key::KeyE,
        0x46 => Key::KeyF,
        0x47 => Key::KeyG,
        0x48 => Key::KeyH,
        0x49 => Key::KeyI,
        0x4A => Key::KeyJ,
        0x4B => Key::KeyK,
        0x4C => Key::KeyL,
        0x4D => Key::KeyM,
        0x4E => Key::KeyN,
        0x4F => Key::KeyO,
        0x50 => Key::KeyP,
        0x51 => Key::KeyQ,
        0x52 => Key::KeyR,
        0x53 => Key::KeyS,
        0x54 => Key::KeyT,
        0x55 => Key::KeyU,
        0x56 => Key::KeyV,
        0x57 => Key::KeyW,
        0x58 => Key::KeyX,
        0x59 => Key::KeyY,
        0x5A => Key::KeyZ,
        // Numbers 0-9 (0x30-0x39)
        0x30 => Key::Num0,
        0x31 => Key::Num1,
        0x32 => Key::Num2,
        0x33 => Key::Num3,
        0x34 => Key::Num4,
        0x35 => Key::Num5,
        0x36 => Key::Num6,
        0x37 => Key::Num7,
        0x38 => Key::Num8,
        0x39 => Key::Num9,
        // Modifiers
        0xA0 | 0xA1 | 0x10 => Key::Shift, // VK_LSHIFT, VK_RSHIFT, VK_SHIFT
        0xA2 | 0xA3 | 0x11 => Key::Control, // VK_LCONTROL, VK_RCONTROL, VK_CONTROL
        0xA4 | 0xA5 | 0x12 => Key::Option, // VK_LMENU, VK_RMENU, VK_MENU (Alt)
        0x5B | 0x5C => Key::Command,      // VK_LWIN, VK_RWIN
        // Special keys
        0x0D => Key::Enter,     // VK_RETURN
        0x1B => Key::Escape,    // VK_ESCAPE
        0x20 => Key::Space,     // VK_SPACE
        0x09 => Key::Tab,       // VK_TAB
        0x08 => Key::Backspace, // VK_BACK
        0x2E => Key::Delete,    // VK_DELETE
        // Arrow keys
        0x25 => Key::LeftArrow,  // VK_LEFT
        0x26 => Key::UpArrow,    // VK_UP
        0x27 => Key::RightArrow, // VK_RIGHT
        0x28 => Key::DownArrow,  // VK_DOWN
        // Punctuation/symbols
        0xBD => Key::Minus,        // VK_OEM_MINUS
        0xBB => Key::Equal,        // VK_OEM_PLUS (= key)
        0xDB => Key::LeftBracket,  // VK_OEM_4
        0xDD => Key::RightBracket, // VK_OEM_5
        0xDC => Key::Backslash,    // VK_OEM_5
        0xBA => Key::Semicolon,    // VK_OEM_1
        0xDE => Key::Quote,        // VK_OEM_7
        0xC0 => Key::Backquote,    // VK_OEM_3
        0xBC => Key::Comma,        // VK_OEM_COMMA
        0xBE => Key::Period,       // VK_OEM_PERIOD
        0xBF => Key::Slash,        // VK_OEM_2
        // Function keys — map F6 to Fn for Windows default hotkey
        0x75 => Key::Fn, // VK_F6 → maps to Fn so existing hotkey config "Fn" works
        // Fallback
        k => Key::Unknown(k as u16),
    }
}

// ============================================================================
// Low-Level Keyboard Hook Callback
// ============================================================================

unsafe extern "system" fn keyboard_hook_callback(
    n_code: i32,
    w_param: WPARAM,
    l_param: LPARAM,
) -> LRESULT {
    if n_code >= 0 {
        LAST_HOOK_EPOCH_MS.store(now_epoch_ms(), Ordering::Relaxed);
        let kb_struct = &*(l_param as *const KBDLLHOOKSTRUCT);
        let vk_code = kb_struct.vkCode;

        let is_press = match w_param as u32 {
            WM_KEYDOWN | WM_SYSKEYDOWN => true,
            WM_KEYUP | WM_SYSKEYUP => false,
            _ => return CallNextHookEx(null_mut(), n_code, w_param, l_param),
        };

        let internal_key = vk_to_key(vk_code);
        let raw_key_str = key_to_string(&internal_key);
        let key_str = normalize_key_string_platform(&raw_key_str);

        let edge = if is_press { "down" } else { "up" };
        println!(
            "🎹 [key_debug][windows] vk={} edge={} raw='{}' normalized='{}'",
            vk_code, edge, raw_key_str, key_str
        );
        // Also send to the Windows debugger output stream (useful when stdout capture is flaky).
        let dbg = format!(
            "[key_debug][windows] vk={} edge={} raw='{}' normalized='{}'\0",
            vk_code, edge, raw_key_str, key_str
        );
        let wide: Vec<u16> = OsStr::new(&dbg).encode_wide().collect();
        OutputDebugStringW(wide.as_ptr());

        if let Ok(mut lock_guard) = GLOBAL_STATE.try_lock() {
            if let Some(state) = lock_guard.as_mut() {
                // Hotkey recording mode: emit key events to frontend
                let is_recording_mode = state
                    .context
                    .recording_state
                    .try_lock()
                    .map(|g| *g)
                    .unwrap_or(false);

                if is_recording_mode {
                    let app_clone = state.context.app.clone();
                    let internal_key_str = key_to_string(&internal_key);
                    tauri::async_runtime::spawn(async move {
                        let _ = app_clone.emit(
                            "hotkey-recorded",
                            serde_json::json!({
                                "key": internal_key_str,
                                "modifiers": []
                            }),
                        );
                    });
                    let event_str = if is_press {
                        format!("key_press: {:?}", key_to_string(&internal_key))
                    } else {
                        format!("key_release: {:?}", key_to_string(&internal_key))
                    };
                    let app_clone = state.context.app.clone();
                    tauri::async_runtime::spawn(async move {
                        let _ = app_clone.emit("global-input", &event_str);
                    });
                }

                // Process hotkey tracking
                if let Ok(mut tracker) = state.context.tracker.try_lock() {
                    tracker.update_key_state(&key_str, is_press);

                    let recording_hotkeys = state.context.config_rx.borrow().clone();
                    let action_hotkeys = state.context.action_hotkey_rx.borrow().clone();

                    let cmds = tracker.process_events(
                        &action_hotkeys,
                        &recording_hotkeys,
                        &key_str,
                        is_press,
                    );

                    for cmd in cmds {
                        match cmd {
                            HotkeyCommandResult::SendNow(c) => {
                                // When a meeting is recording, ignore assistant/action start commands
                                let is_start_cmd = matches!(
                                    c,
                                    RecordingCommand::Start
                                        | RecordingCommand::ActionStart
                                        | RecordingCommand::SwitchToAction
                                        | RecordingCommand::SwitchToAssistant
                                );
                                if is_start_cmd && *state.context.meeting_recording_rx.borrow() {
                                    continue;
                                }
                                if let Err(e) = state.context.recording_tx.send(c) {
                                    eprintln!("Failed to send command: {:?}", e);
                                }
                            }
                            HotkeyCommandResult::SendStopAfter(stop_cmd, delay) => {
                                let tx = state.context.recording_tx.clone();
                                tauri::async_runtime::spawn(async move {
                                    tokio::time::sleep(delay).await;
                                    let _ = tx.send(stop_cmd);
                                });
                            }
                        }
                    }
                }
            }
        }
    }

    CallNextHookEx(null_mut(), n_code, w_param, l_param)
}

fn now_epoch_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn log_key(vk_code: u32, is_press: bool, raw_key_str: &str, key_str: &str) {
    let edge = if is_press { "down" } else { "up" };
    println!(
        "🎹 [key_debug][windows] vk={} edge={} raw='{}' normalized='{}'",
        vk_code, edge, raw_key_str, key_str
    );
    let dbg = format!(
        "[key_debug][windows] vk={} edge={} raw='{}' normalized='{}'\0",
        vk_code, edge, raw_key_str, key_str
    );
    let wide: Vec<u16> = OsStr::new(&dbg).encode_wide().collect();
    unsafe {
        OutputDebugStringW(wide.as_ptr());
    }
}

fn process_key_event(vk_code: u32, is_press: bool) {
    let internal_key = vk_to_key(vk_code);
    let raw_key_str = key_to_string(&internal_key);
    let key_str = normalize_key_string_platform(&raw_key_str);
    log_key(vk_code, is_press, &raw_key_str, &key_str);

    if let Ok(mut lock_guard) = GLOBAL_STATE.try_lock() {
        if let Some(state) = lock_guard.as_mut() {
            // Hotkey recording mode: emit key events to frontend
            let is_recording_mode = state
                .context
                .recording_state
                .try_lock()
                .map(|g| *g)
                .unwrap_or(false);

            if is_recording_mode {
                let app_clone = state.context.app.clone();
                let internal_key_str = raw_key_str.clone();
                tauri::async_runtime::spawn(async move {
                    let _ = app_clone.emit(
                        "hotkey-recorded",
                        serde_json::json!({
                            "key": internal_key_str,
                            "modifiers": []
                        }),
                    );
                });
            }

            if let Ok(mut tracker) = state.context.tracker.try_lock() {
                tracker.update_key_state(&key_str, is_press);

                let recording_hotkeys = state.context.config_rx.borrow().clone();
                let action_hotkeys = state.context.action_hotkey_rx.borrow().clone();

                let cmds = tracker.process_events(
                    &action_hotkeys,
                    &recording_hotkeys,
                    &key_str,
                    is_press,
                );

                for cmd in cmds {
                    match cmd {
                        HotkeyCommandResult::SendNow(c) => {
                            let is_start_cmd = matches!(
                                c,
                                RecordingCommand::Start
                                    | RecordingCommand::ActionStart
                                    | RecordingCommand::SwitchToAction
                                    | RecordingCommand::SwitchToAssistant
                            );
                            if is_start_cmd && *state.context.meeting_recording_rx.borrow() {
                                continue;
                            }
                            let _ = state.context.recording_tx.send(c);
                        }
                        HotkeyCommandResult::SendStopAfter(stop_cmd, delay) => {
                            let tx = state.context.recording_tx.clone();
                            tauri::async_runtime::spawn(async move {
                                tokio::time::sleep(delay).await;
                                let _ = tx.send(stop_cmd);
                            });
                        }
                    }
                }
            }
        }
    }
}

fn start_polling_fallback_thread() {
    std::thread::spawn(move || {
        // Polling fallback aggregates modifier variants into ONE canonical key state.
        // This avoids flicker where generic + side-specific VKs disagree and all map to the same
        // normalized string (e.g. "Control"), which would otherwise cause false press/release edges.
        use std::collections::HashMap;
        let mut prev: HashMap<String, bool> = HashMap::new();

        let is_vk_down = |vk: i32| unsafe { ((GetAsyncKeyState(vk) as u16) & 0x8000) != 0 };

        fn set_modifier_state(
            prev: &mut HashMap<String, bool>,
            key: &str,
            representative_vk: u32,
            down: bool,
        ) {
            let was = *prev.get(key).unwrap_or(&false);
            if down != was {
                prev.insert(key.to_string(), down);
                process_key_event(representative_vk, down);
            }
        }

        loop {
            std::thread::sleep(Duration::from_millis(16));

            // Only activate polling when the hook hasn't delivered anything recently.
            // This matches the "app focused => hook silent" behavior without duplicating events
            // during normal operation.
            let now = now_epoch_ms();
            let last = LAST_HOOK_EPOCH_MS.load(Ordering::Relaxed);
            if last != 0 && now.saturating_sub(last) < 250 {
                continue;
            }

            // Modifiers: OR all variants into a single canonical state.
            let control_down = is_vk_down(0x11) || is_vk_down(0xA2) || is_vk_down(0xA3);
            let option_down =
                is_vk_down(VK_MENU as i32) || is_vk_down(VK_LMENU as i32) || is_vk_down(VK_RMENU as i32);
            let shift_down = is_vk_down(VK_SHIFT as i32);
            let windows_down = is_vk_down(VK_LWIN as i32) || is_vk_down(VK_RWIN as i32);

            set_modifier_state(&mut prev, "Control", 0x11u32, control_down); // VK_CONTROL
            set_modifier_state(&mut prev, "Option", VK_MENU as u32, option_down);
            set_modifier_state(&mut prev, "Shift", VK_SHIFT as u32, shift_down);
            set_modifier_state(&mut prev, "Windows", VK_LWIN as u32, windows_down);

            // A-Z
            for vk in 0x41u32..=0x5Au32 {
                let down = is_vk_down(vk as i32);
                let k = format!("vk:{}", vk);
                let was = *prev.get(&k).unwrap_or(&false);
                if down != was {
                    prev.insert(k, down);
                    process_key_event(vk, down);
                }
            }

            // 0-9
            for vk in 0x30u32..=0x39u32 {
                let down = is_vk_down(vk as i32);
                let k = format!("vk:{}", vk);
                let was = *prev.get(&k).unwrap_or(&false);
                if down != was {
                    prev.insert(k, down);
                    process_key_event(vk, down);
                }
            }
        }
    });
}

// ============================================================================
// Public API
// ============================================================================

pub(crate) fn start_listener(
    app: AppHandle,
    recording_tx: mpsc::Sender<RecordingCommand>,
    config_rx: watch::Receiver<Vec<String>>,
    action_hotkey_rx: watch::Receiver<Vec<String>>,
    recording_state: Arc<Mutex<bool>>,
    meeting_recording_rx: watch::Receiver<bool>,
) {
    *GLOBAL_STATE.lock().unwrap() = Some(WindowsGlobalKeyListenerState {
        context: GlobalKeyListenerContext {
            app,
            recording_tx,
            config_rx,
            action_hotkey_rx,
            recording_state,
            meeting_recording_rx,
            tracker: Arc::new(Mutex::new(KeyStateTracker::new())),
        },
    });

    std::thread::spawn(move || unsafe {
        // Ensure this thread has a message queue before installing the hook.
        // Without this, some environments can install the hook successfully but never
        // deliver callbacks because the queue isn't created yet.
        let mut msg: MSG = std::mem::zeroed();
        let _ = PeekMessageW(&mut msg, null_mut(), 0, 0, PM_NOREMOVE);

        // Start the fallback poller (it stays idle unless the hook goes silent).
        start_polling_fallback_thread();

        let hook = SetWindowsHookExW(
            WH_KEYBOARD_LL,
            Some(keyboard_hook_callback),
            GetModuleHandleW(null_mut()),
            0,
        );

        if hook.is_null() {
            eprintln!("❌ Failed to set Windows keyboard hook (SetWindowsHookExW returned null)");
            return;
        }

        println!("✅ Windows low-level keyboard hook installed successfully");

        // Message pump — required to keep the hook alive.
        // GetMessageW blocks until a message is available; the hook callback
        // fires on the same thread via the Windows message dispatch mechanism.
        while GetMessageW(&mut msg, null_mut(), 0, 0) > 0 {
            DispatchMessageW(&msg);
        }

        UnhookWindowsHookEx(hook);
        println!("🛑 Windows keyboard hook removed");
    });
}
