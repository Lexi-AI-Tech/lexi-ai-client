//! macOS Native Event Tap Listener

use crate::RecordingCommand;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use tauri::{AppHandle, Emitter};
use tokio::sync::watch;

use super::{key_to_string, normalize_key_string, HotkeyCommandResult, Key, KeyStateTracker};

use objc2_core_foundation::{kCFRunLoopCommonModes, CFMachPort, CFRetained, CFRunLoop};
use objc2_core_graphics::{
    kCGEventMaskForAllEvents, CGEvent, CGEventField, CGEventFlags, CGEventTapCallBack,
    CGEventTapLocation, CGEventTapOptions, CGEventTapPlacement, CGEventTapProxy, CGEventType,
};
use objc2_foundation::NSAutoreleasePool;
use std::os::raw::c_void;
use std::ptr::{null_mut, NonNull};
use std::time::{SystemTime, UNIX_EPOCH};

static LAST_EVENT_EPOCH_MS: AtomicU64 = AtomicU64::new(0);
/// Updated on every CGEventTap callback (keyboard, mouse, tap-disabled pings, etc.).
/// Used to distinguish “user idle on keyboard” from “tap not delivering anything”.
static LAST_TAP_CALLBACK_EPOCH_MS: AtomicU64 = AtomicU64::new(0);

fn now_epoch_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn reset_tracker_state(state: &MacGlobalKeyListenerState) {
    if let Ok(mut tracker) = state.context.tracker.try_lock() {
        *tracker = KeyStateTracker::new();
    }
}

/// Convert macOS virtual keycode to our internal Key enum
fn macos_keycode_to_key(keycode: i64) -> Key {
    match keycode {
        0x00 => Key::KeyA,
        0x01 => Key::KeyS,
        0x02 => Key::KeyD,
        0x03 => Key::KeyF,
        0x04 => Key::KeyH,
        0x05 => Key::KeyG,
        0x06 => Key::KeyZ,
        0x07 => Key::KeyX,
        0x08 => Key::KeyC,
        0x09 => Key::KeyV,
        0x0A => Key::Backquote,
        0x0B => Key::KeyB,
        0x0C => Key::KeyQ,
        0x0D => Key::KeyW,
        0x0E => Key::KeyE,
        0x0F => Key::KeyR,
        0x10 => Key::KeyY,
        0x11 => Key::KeyT,
        0x12 => Key::Num1,
        0x13 => Key::Num2,
        0x14 => Key::Num3,
        0x15 => Key::Num4,
        0x16 => Key::Num6,
        0x17 => Key::Num5,
        0x18 => Key::Equal,
        0x19 => Key::Num9,
        0x1A => Key::Num7,
        0x1B => Key::Minus,
        0x1C => Key::Num8,
        0x1D => Key::Num0,
        0x1E => Key::RightBracket,
        0x1F => Key::KeyO,
        0x20 => Key::KeyU,
        0x21 => Key::LeftBracket,
        0x22 => Key::KeyI,
        0x23 => Key::KeyP,
        0x24 => Key::Enter,
        0x25 => Key::KeyL,
        0x26 => Key::KeyJ,
        0x27 => Key::Quote,
        0x28 => Key::KeyK,
        0x29 => Key::Semicolon,
        0x2A => Key::Backslash,
        0x2B => Key::Comma,
        0x2C => Key::Slash,
        0x2D => Key::KeyN,
        0x2E => Key::KeyM,
        0x2F => Key::Period,
        0x30 => Key::Tab,
        0x31 => Key::Space,
        0x32 => Key::Backquote,
        0x33 => Key::Backspace,
        0x35 => Key::Escape,
        0x36 => Key::Command, // Command Right
        0x37 => Key::Command, // Command Left
        0x38 => Key::Shift,   // Shift Left
        0x3A => Key::Option,  // Option Left
        0x3B => Key::Control, // Control Left
        0x3C => Key::Shift,   // Shift Right
        0x3D => Key::Option,  // Option Right
        0x3E => Key::Control, // Control Right
        0x3F => Key::Fn,
        0x47 => Key::Delete,
        0x7B => Key::LeftArrow,
        0x7C => Key::RightArrow,
        0x7D => Key::DownArrow,
        0x7E => Key::UpArrow,
        k => Key::Unknown(k as u16),
    }
}

// Global state block required for the free-standing C callback
lazy_static::lazy_static! {
    static ref GLOBAL_STATE: Mutex<Option<MacGlobalKeyListenerState>> = Mutex::new(None);
}

use super::GlobalKeyListenerContext;

struct MacGlobalKeyListenerState {
    context: GlobalKeyListenerContext,
    tap: Option<CFRetained<CFMachPort>>,
    run_loop: Option<CFRetained<CFRunLoop>>,
}
// CFRetained<CFMachPort> is !Send and !Sync, so we must unsafe impl it for the struct.
unsafe impl Send for MacGlobalKeyListenerState {}
unsafe impl Sync for MacGlobalKeyListenerState {}

unsafe extern "C-unwind" fn raw_callback(
    _proxy: CGEventTapProxy,
    _type: CGEventType,
    cg_event: NonNull<CGEvent>,
    _user_info: *mut c_void,
) -> *mut CGEvent {
    // Any invocation means the tap + run loop are still delivering (not keyboard-specific).
    LAST_TAP_CALLBACK_EPOCH_MS.store(now_epoch_ms(), Ordering::Relaxed);

    // macOS can disable event taps if the callback is slow or due to user input.
    // If we don't re-enable, hotkeys silently stop working while the app keeps running.
    if matches!(
        _type,
        CGEventType::TapDisabledByTimeout | CGEventType::TapDisabledByUserInput
    ) {
        // Use try_lock() to avoid blocking inside the event tap callback thread.
        if let Ok(lock_guard) = GLOBAL_STATE.try_lock() {
            if let Some(state) = lock_guard.as_ref() {
                if let Some(tap) = state.tap.as_ref() {
                    CGEvent::tap_enable(&*tap, true);
                    reset_tracker_state(state);
                    eprintln!(
                        "⚠️  CGEventTap was disabled; re-enabled automatically ({:?})",
                        _type
                    );
                } else {
                    eprintln!("⚠️  CGEventTap disabled but tap not set ({:?})", _type);
                }
            }
        }
        return cg_event.as_ptr();
    }

    // Only capture keyboard events
    let is_press = match _type {
        CGEventType::KeyDown | CGEventType::FlagsChanged => true, // Treat FlagsChanged as press temporarily, will refine based on key state
        CGEventType::KeyUp => false,
        _ => return cg_event.as_ptr(), // Ignore mouse/scroll
    };

    LAST_EVENT_EPOCH_MS.store(now_epoch_ms(), Ordering::Relaxed);

    let keycode =
        CGEvent::integer_value_field(Some(cg_event.as_ref()), CGEventField::KeyboardEventKeycode);

    // Completely swallow Globe/Fn key synthetic keyDown/keyUp (179) to prevent macOS emoji popup
    if keycode == 179 {
        CGEvent::set_type(Some(cg_event.as_ref()), CGEventType::Null);
        return null_mut();
    }

    // For FlagsChanged (modifiers like Fn, Shift, Cmd), there is no 'KeyUp' event type.
    // Instead, macOS sends a FlagsChanged whenever it changes state.
    // We determine press vs release by checking if the specific flag is currently set in the event flags.
    let is_actual_press = if _type == CGEventType::FlagsChanged {
        let flags = CGEvent::flags(Some(cg_event.as_ref()));
        match keycode {
            0x3F => flags.contains(CGEventFlags::MaskSecondaryFn),
            0x37 | 0x36 => flags.contains(CGEventFlags::MaskCommand),
            0x3B | 0x3E => flags.contains(CGEventFlags::MaskControl),
            0x3A | 0x3D => flags.contains(CGEventFlags::MaskAlternate),
            0x38 | 0x3C => flags.contains(CGEventFlags::MaskShift),
            _ => is_press,
        }
    } else {
        is_press
    };

    let internal_key = macos_keycode_to_key(keycode);
    let key_str = normalize_key_string(&key_to_string(&internal_key));

    // Process safely without keeping the lock too long
    if let Ok(mut lock_guard) = GLOBAL_STATE.try_lock() {
        if let Some(state) = lock_guard.as_mut() {
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
                let event_str = if is_actual_press {
                    format!("key_press: {:?}", key_to_string(&internal_key))
                } else {
                    format!("key_release: {:?}", key_to_string(&internal_key))
                };
                let app_clone = state.context.app.clone();
                tauri::async_runtime::spawn(async move {
                    let _ = app_clone.emit("global-input", &event_str);
                });
            }

            if let Ok(mut tracker) = state.context.tracker.try_lock() {
                tracker.update_key_state(&key_str, is_actual_press);

                let recording_hotkeys_guard = state.context.config_rx.borrow();
                let action_hotkeys_guard = state.context.action_hotkey_rx.borrow();

                let cmds = tracker.process_events(
                    &*action_hotkeys_guard,
                    &*recording_hotkeys_guard,
                    &key_str,
                    is_actual_press,
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
                                continue; // Disable assistant and action mode while meeting is running
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

    // println!("key_str: {:?}, internal_key: {:?}", key_str, internal_key);

    // If the key is Fn, consume it to prevent the macOS emoji popup
    if internal_key == Key::Fn {
        CGEvent::set_type(Some(cg_event.as_ref()), CGEventType::Null);
        return null_mut();
    }

    // Pass the event on to macOS applications unchanged
    cg_event.as_ptr()
}

pub(crate) fn start_listener(
    app: AppHandle,
    recording_tx: mpsc::Sender<RecordingCommand>,
    config_rx: watch::Receiver<Vec<String>>,
    action_hotkey_rx: watch::Receiver<Vec<String>>,
    recording_state: Arc<Mutex<bool>>,
    meeting_recording_rx: watch::Receiver<bool>,
) {
    *GLOBAL_STATE.lock().unwrap() = Some(GlobalListenerState {
        app: app.clone(),
        recording_tx,
        config_rx,
        action_hotkey_rx,
        recording_state,
        meeting_recording_rx,
        tracker: Arc::new(Mutex::new(KeyStateTracker::new())),
        tap: None,
        run_loop: None,
    });

    spawn_tap_thread();
}

fn spawn_tap_thread() {
    std::thread::spawn(move || unsafe {
        let _pool = NSAutoreleasePool::new();
        let callback: CGEventTapCallBack = Some(raw_callback);

        let tap = match CGEvent::tap_create(
            CGEventTapLocation::HIDEventTap,
            CGEventTapPlacement::HeadInsertEventTap,
            CGEventTapOptions::Default,
            kCGEventMaskForAllEvents.into(),
            callback,
            null_mut(),
        ) {
            Some(tap) => tap,
            None => {
                eprintln!("Failed to create CGEventTap. Accessibility permission likely missing (System Settings -> Privacy & Security -> Accessibility).");
                return;
            }
        };

        let loop_source = CFMachPort::new_run_loop_source(None, Some(&tap), 0)
            .expect("Failed to create loop source");

        // Store the tap in the global state so it can be re-enabled on system wake.
        if let Ok(mut lock_guard) = GLOBAL_STATE.lock() {
            if let Some(state) = lock_guard.as_mut() {
                state.tap = Some(tap.clone());
            }
        }

        let current_loop = CFRunLoop::current().unwrap();
        if let Ok(mut lock_guard) = GLOBAL_STATE.lock() {
            if let Some(state) = lock_guard.as_mut() {
                state.run_loop = Some(current_loop.clone());
            }
        }
        current_loop.add_source(Some(&loop_source), kCFRunLoopCommonModes);

        CGEvent::tap_enable(&*tap, true);

        let now = now_epoch_ms();
        LAST_EVENT_EPOCH_MS.store(now, Ordering::Relaxed);
        LAST_TAP_CALLBACK_EPOCH_MS.store(now, Ordering::Relaxed);
        println!("✅ Native macOS CGEventTap started");
        CFRunLoop::run();
    });
}

/// Re-enables the global keyboard event tap.
///
/// This is specifically used on system wake, as macOS often invalidates
/// or disables CGEventTaps when the system goes to sleep.
pub(crate) fn re_enable_tap() {
    if let Ok(lock_guard) = GLOBAL_STATE.lock() {
        if let Some(state) = lock_guard.as_ref() {
            if let Some(tap) = state.tap.as_ref() {
                CGEvent::tap_enable(&*tap, true);
                reset_tracker_state(state);
            } else {
                eprintln!("⚠️  Cannot re-enable CGEventTap: Tap was not initialized.");
            }
        }
    }
}

/// Hard reset: stop old runloop + recreate event tap thread.
pub(crate) fn hard_reset_tap() {
    // Capture the state we need to recreate the tap thread.
    let (
        old_tap,
        old_loop,
        app,
        recording_tx,
        config_rx,
        action_hotkey_rx,
        recording_state,
        meeting_recording_rx,
    ) = match GLOBAL_STATE.lock() {
        Ok(mut guard) => {
            let Some(state) = guard.as_mut() else {
                eprintln!("⚠️  Cannot hard reset CGEventTap: Global state missing.");
                return;
            };

            println!("🧯 Hard resetting CGEventTap (recreate tap + runloop)...");

            let old_tap = state.tap.take();
            let old_loop = state.run_loop.take();

            // Clone the inputs needed to re-create a listener state.
            let app = state.app.clone();
            let recording_tx = state.recording_tx.clone();
            let config_rx = state.config_rx.clone();
            let action_hotkey_rx = state.action_hotkey_rx.clone();
            let recording_state = state.recording_state.clone();
            let meeting_recording_rx = state.meeting_recording_rx.clone();

            // Reset tracker immediately so we don't carry stuck modifier state across resets.
            reset_tracker_state(state);

            (
                old_tap,
                old_loop,
                app,
                recording_tx,
                config_rx,
                action_hotkey_rx,
                recording_state,
                meeting_recording_rx,
            )
        }
        Err(_) => {
            eprintln!("⚠️  Cannot hard reset CGEventTap: Global state lock poisoned.");
            return;
        }
    };

    // Disable old tap (best effort).
    if let Some(tap) = old_tap.as_ref() {
        CGEvent::tap_enable(&*tap, false);
    }

    // Stop the old runloop so the old tap thread can exit cleanly (best effort).
    if let Some(loop_ref) = old_loop.as_ref() {
        loop_ref.stop();
    }

    // Re-initialize global state and spawn a fresh tap thread.
    *GLOBAL_STATE.lock().unwrap() = Some(MacGlobalKeyListenerState {
        context: GlobalKeyListenerContext {
            app,
            recording_tx,
            config_rx,
            action_hotkey_rx,
            recording_state,
            meeting_recording_rx,
            tracker: Arc::new(Mutex::new(KeyStateTracker::new())),
        },
        tap: None,
        run_loop: None,
    });

    spawn_tap_thread();
}

#[allow(dead_code)]
pub(crate) fn last_event_age_ms() -> Option<u64> {
    let last = LAST_EVENT_EPOCH_MS.load(Ordering::Relaxed);
    if last == 0 {
        return None;
    }
    let now = now_epoch_ms();
    Some(now.saturating_sub(last))
}

/// `None` if the listener has not registered a tap yet (or lock failed).
pub(crate) fn event_tap_is_enabled() -> Option<bool> {
    let lock_guard = GLOBAL_STATE.lock().ok()?;
    let state = lock_guard.as_ref()?;
    let tap = state.tap.as_ref()?;
    Some(CGEvent::tap_is_enabled(&*tap))
}

#[allow(dead_code)]
pub(crate) fn last_tap_callback_age_ms() -> Option<u64> {
    let last = LAST_TAP_CALLBACK_EPOCH_MS.load(Ordering::Relaxed);
    if last == 0 {
        return None;
    }
    let now = now_epoch_ms();
    Some(now.saturating_sub(last))
}
