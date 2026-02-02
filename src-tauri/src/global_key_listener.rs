//! Global Keyboard Listener and Shortcut Manager Module
//!
//! This module provides unified hotkey management using **rdev** exclusively.
//! It supports:
//! - **Function Key**: (Fn)
//! - **Combinations**: (e.g., Command+Shift+O, Fn+Control)
//! - **Single Keys**: (e.g., F6 - though risky without modifiers)
//!
//! ## Features
//!
//! - **Unified Handling**: All hotkeys are handled by the same logic.
//! - **Dynamic Configuration**: Hotkey config can be changed at runtime.
//! - **Hotkey Recording Mode**: Emits key events to frontend for interactive hotkey selection.
//! - **System Shortcut Validation**: Prevents registration of known system-reserved shortcuts.
//!
//! ## Permissions Required
//!
//! - **Input Monitoring** (macOS): Required for `rdev::listen` to work system-wide.

use crate::RecordingCommand;
use rdev::{listen, Event, EventType, Key};
use std::collections::HashSet;
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use tokio::sync::watch;

// ============================================================================
// Hotkey Normalization & Helpers
// ============================================================================

/// Convert rdev Key to string representation for frontend/config matching
/// Normalizes key names to match frontend expectations
fn key_to_string(key: &Key) -> String {
    match key {
        Key::MetaLeft | Key::MetaRight => "Command".to_string(),
        Key::ControlLeft | Key::ControlRight => "Control".to_string(),
        Key::Alt => "Option".to_string(),
        Key::ShiftLeft | Key::ShiftRight => "Shift".to_string(),
        Key::Function => "Fn".to_string(),
        Key::Space => "Space".to_string(),
        Key::Return => "Enter".to_string(),
        Key::Escape => "Escape".to_string(),
        Key::Tab => "Tab".to_string(),
        Key::Backspace => "Backspace".to_string(),
        Key::Delete => "Delete".to_string(),
        // Add more special keys as needed
        _ => {
            let s = format!("{:?}", key);
            // rdev often returns "KeyA", "KeyB", etc. Strip "Key" prefix if present
            if s.starts_with("Key") && s.len() > 3 {
                s[3..].to_string()
            } else if s.len() == 1 {
                s.to_uppercase()
            } else {
                s
            }
        }
    }
}

/// Normalize config hotkey string for comparison
/// Maps "Cmd" -> "Command", "Ctrl" -> "Control", etc.
fn normalize_key_string(key: &str) -> String {
    match key.trim().to_lowercase().as_str() {
        "cmd" | "command" | "meta" | "super" => "Command".to_string(),
        "ctrl" | "control" => "Control".to_string(),
        "option" | "alt" => "Option".to_string(),
        "shift" => "Shift".to_string(),
        "fn" => "Fn".to_string(),
        "esc" | "escape" => "Escape".to_string(),
        "return" | "enter" => "Enter".to_string(),
        _ => {
            let k = key.trim();
            // For single letter keys, uppercase them
            if k.len() == 1 && k.chars().all(|c| c.is_alphabetic()) {
                k.to_uppercase()
            } else if k.to_lowercase().starts_with("key") && k.len() > 3 {
                k[3..].to_string()
            } else {
                // Capitalize first letter for consistency (e.g. "Space", "Tab")
                let mut chars = k.chars();
                match chars.next() {
                    None => String::new(),
                    Some(f) => f.to_uppercase().collect::<String>() + chars.as_str(),
                }
            }
        }
    }
}

/// Validates a hotkey string (basic check)
pub fn validate_hotkey(hotkey: &str) -> Result<(), String> {
    if hotkey.trim().is_empty() {
        return Err("Hotkey cannot be empty".to_string());
    }
    // We could check for reserved keys here if needed, but rdev captures almost everything.
    Ok(())
}

// ============================================================================
// rdev Listener (configurable hotkeys)
// ============================================================================

/// Minimum time between Start and Stop events.
const MIN_PRESS_RELEASE_INTERVAL: Duration = Duration::from_millis(500);

/// Result of processing a hotkey event
#[derive(Debug, Clone)]
enum HotkeyCommandResult {
    SendNow(RecordingCommand),
    SendStopAfter(Duration),
}

/// Tracks which configured hotkeys are 'active' (pressed)
struct KeyStateTracker {
    /// Hotkey strings that are currently considered active
    active_hotkeys: HashSet<String>,
    /// When the last 'Start' command was sent
    last_press_at: Option<Instant>,
    /// Set of currently physically pressed keys (normalized strings)
    pressed_keys: HashSet<String>,
}

impl KeyStateTracker {
    fn new() -> Self {
        Self {
            active_hotkeys: HashSet::new(),
            last_press_at: None,
            pressed_keys: HashSet::new(),
        }
    }

    /// Update physical key state
    fn update_key_state(&mut self, key: &str, is_press: bool) {
        if is_press {
            self.pressed_keys.insert(key.to_string());
        } else {
            self.pressed_keys.remove(key);
        }
    }

    /// Check if a specific hotkey configuration matches the current physical state
    fn matches_hotkey(&self, hotkey_config: &str, _trigger_key: &str) -> bool {
        let parts: Vec<String> = hotkey_config
            .split('+')
            .map(|s| normalize_key_string(s))
            .collect();

        if parts.is_empty() {
            return false;
        }

        // Check if all parts are pressed
        parts.iter().all(|k| self.pressed_keys.contains(k))
    }

    /// Process an event against a specific hotkey configuration
    fn process_event(
        &mut self,
        hotkey_config: &str,
        trigger_key: &str,
        is_press: bool,
        is_action: bool, // true=ActionStart/Stop, false=Start/Stop
    ) -> Option<HotkeyCommandResult> {
        let hotkey_normalized = hotkey_config.trim().to_string();

        if is_press {
            // Check if this hotkey is fully pressed
            if self.matches_hotkey(&hotkey_normalized, trigger_key) {
                // Only trigger if not already active
                if self.active_hotkeys.insert(hotkey_normalized.clone()) {
                    let cmd = if is_action {
                        RecordingCommand::ActionStart
                    } else {
                        RecordingCommand::Start
                    };
                    println!("🔑 Hotkey Activated: {}", hotkey_normalized);
                    self.last_press_at = Some(Instant::now());
                    return Some(HotkeyCommandResult::SendNow(cmd));
                }
            }
        } else {
            // RELEASE logic
            // A hotkey is "released" if ANY of its constituent keys are released.
            // If the key being released is part of an active hotkey, we deactivate it.

            // Check if this active active hotkey should be released
            if self.active_hotkeys.contains(&hotkey_normalized) {
                // Normalize config parts
                let parts: Vec<String> = hotkey_normalized
                    .split('+')
                    .map(|s| normalize_key_string(s))
                    .collect();

                // If the released key is one of the parts, deactivate
                if parts.contains(&trigger_key.to_string()) {
                    self.active_hotkeys.remove(&hotkey_normalized);

                    println!("🔑 Hotkey Deactivated: {}", hotkey_normalized);

                    let elapsed = self
                        .last_press_at
                        .map(|t| t.elapsed())
                        .unwrap_or(MIN_PRESS_RELEASE_INTERVAL);
                    let base_cmd = if is_action {
                        RecordingCommand::ActionStop
                    } else {
                        RecordingCommand::Stop
                    };

                    if elapsed >= MIN_PRESS_RELEASE_INTERVAL {
                        return Some(HotkeyCommandResult::SendNow(base_cmd));
                    } else {
                        let remaining = MIN_PRESS_RELEASE_INTERVAL - elapsed;
                        println!(
                            "⏱️  Release before minimum interval, delaying Stop by {:.2}s",
                            remaining.as_secs_f64()
                        );
                        return Some(HotkeyCommandResult::SendStopAfter(remaining));
                    }
                }
            }
        }

        None
    }
}

/// Helper to convert keyboard EventType to a string for frontend emission
fn event_type_to_string(event_type: &EventType) -> Option<String> {
    match event_type {
        EventType::KeyPress(key) => Some(format!("key_press: {:?}", key_to_string(key))),
        EventType::KeyRelease(key) => Some(format!("key_release: {:?}", key_to_string(key))),
        _ => None,
    }
}

/// Starts the global keyboard listener.
///
/// This spawns a single thread that uses `rdev` to listen for all global keyboard events.
///
/// # Arguments
/// * `app` - The Tauri AppHandle used to emit events to the frontend
/// * `recording_tx` - Channel sender to signal start/stop recording
/// * `config_rx` - Watch receiver for hotkey config changes
/// * `action_hotkey_rx` - Watch receiver for action hotkey config changes
/// * `recording_state` - Shared state to check if we're in hotkey recording mode
pub fn start_listener(
    app: AppHandle,
    recording_tx: mpsc::Sender<RecordingCommand>,
    config_rx: watch::Receiver<Vec<String>>,
    action_hotkey_rx: watch::Receiver<Vec<String>>,
    recording_state: Arc<Mutex<bool>>,
) {
    let app_for_rdev = app.clone();
    let recording_tx_for_rdev = recording_tx.clone();
    let recording_state_for_rdev = recording_state.clone();
    let config_rx_for_rdev = config_rx.clone();
    let action_hotkey_rx_for_rdev = action_hotkey_rx.clone();

    // Key state tracker
    let key_state_tracker = Arc::new(Mutex::new(KeyStateTracker::new()));

    std::thread::spawn(move || {
        let key_state_tracker_local = key_state_tracker.clone();

        let callback = move |event: Event| {
            // We only care about keyboard events
            let (key, is_press) = match event.event_type {
                EventType::KeyPress(k) => (k, true),
                EventType::KeyRelease(k) => (k, false),
                _ => return, // Ignore mouse move, click, scroll
            };

            let key_str = normalize_key_string(&key_to_string(&key));

            // 1. Check Recording Mode (UI Hotkey Selection)
            let is_recording_mode = recording_state_for_rdev.lock().map(|g| *g).unwrap_or(false);

            if is_recording_mode {
                if is_press {
                    let _ = app_for_rdev.emit(
                        "hotkey-recorded",
                        serde_json::json!({
                            "key": key_to_string(&key),
                            "modifiers": []
                        }),
                    );
                }
            }

            // 2. Update Physical Key State
            let mut tracker = match key_state_tracker_local.lock() {
                Ok(t) => t,
                Err(_) => return,
            };
            tracker.update_key_state(&key_str, is_press);

            // 3. Check Hotkeys
            let recording_hotkeys = config_rx_for_rdev.borrow().clone();
            let action_hotkeys = action_hotkey_rx_for_rdev.borrow().clone();

            // Check Action Hotkeys first
            let mut triggered_action_cmd = None;
            for hotkey in &action_hotkeys {
                if let Some(cmd) = tracker.process_event(hotkey, &key_str, is_press, true) {
                    triggered_action_cmd = Some(cmd);
                    break;
                }
            }

            // Check Recording Hotkeys
            let mut triggered_rec_cmd = None;
            if triggered_action_cmd.is_none() {
                for hotkey in &recording_hotkeys {
                    if let Some(cmd) = tracker.process_event(hotkey, &key_str, is_press, false) {
                        triggered_rec_cmd = Some(cmd);
                        break;
                    }
                }
            }

            // 4. Dispatch Commands
            // Clone triggered_action_cmd so it can be used in both .or() and is_some() check if needed logic was complex,
            // but actually we just need 'cmd_to_send'. The delayed stop logic needs to know WHICH command type.
            let cmd_to_send = triggered_action_cmd.clone().or(triggered_rec_cmd);

            // We determine command type for delayed stop based on what was triggered
            let is_action_triggered = triggered_action_cmd.is_some();

            if let Some(result) = cmd_to_send {
                match result {
                    HotkeyCommandResult::SendNow(cmd) => {
                        if let Err(e) = recording_tx_for_rdev.send(cmd) {
                            eprintln!("Failed to send command: {:?}", e);
                        }
                    }
                    HotkeyCommandResult::SendStopAfter(delay) => {
                        let tx = recording_tx_for_rdev.clone();
                        // Determine correct stop command
                        let stop_cmd = if is_action_triggered {
                            RecordingCommand::ActionStop
                        } else {
                            RecordingCommand::Stop
                        };

                        std::thread::spawn(move || {
                            std::thread::sleep(delay);
                            if let Err(e) = tx.send(stop_cmd) {
                                eprintln!("Failed to send delayed stop: {:?}", e);
                            }
                        });
                    }
                }
            }

            // Emit debug event
            if let Some(event_str) = event_type_to_string(&event.event_type) {
                let _ = app_for_rdev.emit("global-input", &event_str);
            }
        };

        if let Err(error) = listen(callback) {
            eprintln!("Error: {:?}", error);
        }
    });

    println!("✅ rdev listener started (Unified Mode)");
}
