//! macOS Native Event Tap Listener

#![cfg(target_os = "macos")]

use crate::RecordingCommand;
use std::sync::{mpsc, Arc, Mutex};
use tauri::{AppHandle, Emitter};
use tokio::sync::watch;

use super::{key_to_string, normalize_key_string, HotkeyCommandResult, Key, KeyStateTracker};

use objc2_core_foundation::{kCFRunLoopCommonModes, CFMachPort, CFRunLoop};
use objc2_core_graphics::{
    kCGEventMaskForAllEvents, CGEvent, CGEventField, CGEventFlags, CGEventTapCallBack,
    CGEventTapLocation, CGEventTapOptions, CGEventTapPlacement, CGEventTapProxy, CGEventType,
};
use objc2_foundation::NSAutoreleasePool;
use std::os::raw::c_void;
use std::ptr::{null_mut, NonNull};

/// Convert macOS virtual keycode to our internal Key enum
fn macos_keycode_to_key(keycode: i64) -> Key {
    match keycode {
        0x37 => Key::Command, // Command Left
        0x36 => Key::Command, // Command Right
        0x3B => Key::Control, // Control Left
        0x3E => Key::Control, // Control Right
        0x3A => Key::Option,  // Option Left
        0x3D => Key::Option,  // Option Right
        0x38 => Key::Shift,   // Shift Left
        0x3C => Key::Shift,   // Shift Right
        0x3F => Key::Fn,
        0x31 => Key::Space,
        0x24 => Key::Enter,
        0x35 => Key::Escape,
        0x30 => Key::Tab,
        0x33 => Key::Backspace,
        0x75 => Key::Delete,
        k => Key::Unknown(k as u16),
    }
}

// Global state block required for the free-standing C callback
lazy_static::lazy_static! {
    static ref GLOBAL_STATE: Mutex<Option<GlobalListenerState>> = Mutex::new(None);
}

struct GlobalListenerState {
    app: AppHandle,
    recording_tx: mpsc::Sender<RecordingCommand>,
    config_rx: watch::Receiver<Vec<String>>,
    action_hotkey_rx: watch::Receiver<Vec<String>>,
    recording_state: Arc<Mutex<bool>>,
    tracker: Arc<Mutex<KeyStateTracker>>,
}

unsafe extern "C-unwind" fn raw_callback(
    _proxy: CGEventTapProxy,
    _type: CGEventType,
    cg_event: NonNull<CGEvent>,
    _user_info: *mut c_void,
) -> *mut CGEvent {
    // Only capture keyboard events
    let is_press = match _type {
        CGEventType::KeyDown | CGEventType::FlagsChanged => true, // Treat FlagsChanged as press temporarily, will refine based on key state
        CGEventType::KeyUp => false,
        _ => return cg_event.as_ptr(), // Ignore mouse/scroll
    };

    let keycode =
        CGEvent::integer_value_field(Some(cg_event.as_ref()), CGEventField::KeyboardEventKeycode);

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
    if let Ok(mut lock_guard) = GLOBAL_STATE.lock() {
        if let Some(state) = lock_guard.as_mut() {
            let is_recording_mode = state.recording_state.lock().map(|g| *g).unwrap_or(false);

            if is_recording_mode {
                if is_actual_press {
                    let _ = state.app.emit(
                        "hotkey-recorded",
                        serde_json::json!({
                            "key": key_to_string(&internal_key),
                            "modifiers": []
                        }),
                    );
                }
                let event_str = if is_actual_press {
                    format!("key_press: {:?}", key_to_string(&internal_key))
                } else {
                    format!("key_release: {:?}", key_to_string(&internal_key))
                };
                let _ = state.app.emit("global-input", &event_str);
            }

            if let Ok(mut tracker) = state.tracker.lock() {
                tracker.update_key_state(&key_str, is_actual_press);

                let recording_hotkeys = state.config_rx.borrow().clone();
                let action_hotkeys = state.action_hotkey_rx.borrow().clone();

                let mut triggered_action_cmd = None;
                for hotkey in &action_hotkeys {
                    if let Some(cmd) =
                        tracker.process_event(hotkey, &key_str, is_actual_press, true)
                    {
                        triggered_action_cmd = Some(cmd);
                        break;
                    }
                }

                let mut triggered_rec_cmd = None;
                if triggered_action_cmd.is_none() {
                    for hotkey in &recording_hotkeys {
                        if let Some(cmd) =
                            tracker.process_event(hotkey, &key_str, is_actual_press, false)
                        {
                            triggered_rec_cmd = Some(cmd);
                            break;
                        }
                    }
                }

                let cmd_to_send = triggered_action_cmd.clone().or(triggered_rec_cmd);
                let is_action_triggered = triggered_action_cmd.is_some();

                if let Some(result) = cmd_to_send {
                    match result {
                        HotkeyCommandResult::SendNow(cmd) => {
                            if let Err(e) = state.recording_tx.send(cmd) {
                                eprintln!("Failed to send command: {:?}", e);
                            }
                        }
                        HotkeyCommandResult::SendStopAfter(delay) => {
                            let tx = state.recording_tx.clone();
                            let stop_cmd = if is_action_triggered {
                                RecordingCommand::ActionStop
                            } else {
                                RecordingCommand::Stop
                            };
                            std::thread::spawn(move || {
                                std::thread::sleep(delay);
                                let _ = tx.send(stop_cmd);
                            });
                        }
                    }
                }
            }
        }
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
) {
    *GLOBAL_STATE.lock().unwrap() = Some(GlobalListenerState {
        app: app.clone(),
        recording_tx,
        config_rx,
        action_hotkey_rx,
        recording_state,
        tracker: Arc::new(Mutex::new(KeyStateTracker::new())),
    });

    std::thread::spawn(move || unsafe {
        let _pool = NSAutoreleasePool::new();
        let callback: CGEventTapCallBack = Some(raw_callback);

        let tap = CGEvent::tap_create(
            CGEventTapLocation::HIDEventTap,
            CGEventTapPlacement::HeadInsertEventTap,
            CGEventTapOptions::Default,
            kCGEventMaskForAllEvents.into(),
            callback,
            null_mut(),
        )
        .expect("Failed to create CGEventTap. Ensure Accessibility permissions are granted!");

        let loop_source = CFMachPort::new_run_loop_source(None, Some(&tap), 0)
            .expect("Failed to create loop source");

        let current_loop = CFRunLoop::current().unwrap();
        current_loop.add_source(Some(&loop_source), kCFRunLoopCommonModes);

        CGEvent::tap_enable(&tap, true);

        println!("✅ Native macOS CGEventTap started");
        CFRunLoop::run();
    });
}
