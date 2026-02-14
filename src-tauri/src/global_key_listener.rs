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
//! - **Superset-Aware Grace Period**: When a hotkey is a subset of another configured hotkey,
//!   triggering is delayed briefly to allow the user to complete the longer combo.
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

/// Parse a hotkey config string into a normalized set of key strings
fn parse_hotkey_parts(hotkey_config: &str) -> HashSet<String> {
    hotkey_config
        .split('+')
        .map(|s| normalize_key_string(s))
        .collect()
}

/// Canonical modifier order for storage and comparison (matches backend/DB).
/// Format: Control+Option+Command+Shift+Key (modifiers in this order, then the key).
/// Fn, when present, is placed first.
const MODIFIER_ORDER: [&str; 5] = ["Fn", "Control", "Option", "Command", "Shift"];

/// Normalize a hotkey string to canonical form for storage and comparison.
/// Order: Fn (if present), Control, Option, Command, Shift, then the key.
pub fn hotkey_to_canonical(hotkey: &str) -> String {
    let parts: Vec<String> = hotkey
        .split('+')
        .map(|s| normalize_key_string(s))
        .filter(|s| !s.is_empty())
        .collect();
    let mut modifiers: Vec<String> = Vec::new();
    let mut keys: Vec<String> = Vec::new();
    for p in &parts {
        if MODIFIER_ORDER.contains(&p.as_str()) {
            if !modifiers.contains(p) {
                modifiers.push(p.clone());
            }
        } else {
            keys.push(p.clone());
        }
    }
    modifiers.sort_by_key(|m| MODIFIER_ORDER.iter().position(|&x| x == m).unwrap_or(99));
    let mut out: Vec<String> = modifiers;
    out.extend(keys);
    out.join("+")
}

/// macOS system-reserved keyboard shortcuts (Apple Support). Stored in canonical form:
/// Control+Option+Command+Shift+Key. These must not be allowed as user-defined hotkeys.
const RESERVED_MACOS_SHORTCUTS: &[&str] = &[
    "Command+A",
    "Command+B",
    "Command+C",
    "Command+D",
    "Command+E",
    "Command+F",
    "Command+G",
    "Command+H",
    "Command+I",
    "Command+J",
    "Command+K",
    "Command+L",
    "Command+M",
    "Command+N",
    "Command+O",
    "Command+P",
    "Command+Q",
    "Command+R",
    "Command+S",
    "Command+T",
    "Command+U",
    "Command+V",
    "Command+W",
    "Command+X",
    "Command+Y",
    "Command+Z",
    "Command+1",
    "Command+2",
    "Command+3",
    "Command+4",
    "Command+,",
    "Command+;",
    "Command+?",
    "Command+Space",
    "Command+Tab",
    "Command+`",
    "Command+Shift+Z",
    "Command+Shift+C",
    "Command+Shift+D",
    "Command+Shift+F",
    "Command+Shift+G",
    "Command+Shift+H",
    "Command+Shift+I",
    "Command+Shift+K",
    "Command+Shift+N",
    "Command+Shift+O",
    "Command+Shift+P",
    "Command+Shift+Q",
    "Command+Shift+R",
    "Command+Shift+S",
    "Command+Shift+T",
    "Command+Shift+;",
    "Command+Shift+3",
    "Command+Shift+4",
    "Command+Shift+5",
    "Command+Shift+6",
    "Command+Shift+Delete",
    "Command+Option+D",
    "Command+Option+F",
    "Command+Option+H",
    "Command+Option+I",
    "Command+Option+L",
    "Command+Option+M",
    "Command+Option+P",
    "Command+Option+T",
    "Command+Option+V",
    "Command+Option+W",
    "Command+Option+Y",
    "Command+Option+8",
    "Command+Option+=",
    "Command+Option+-",
    "Command+Option+Escape",
    "Command+Option+F5",
    "Command+Option+Power",
    "Command+Option+Shift+V",
    "Command+Option+Power",
    "Option+Delete",
    "Command+Option+Shift+Q",
    "Command+Option+Shift+Delete",
    "Control+A",
    "Control+B",
    "Control+Command+F",
    "Control+Command+Q",
    "Control+Command+Space",
    "Control+Command+Power",
    "Control+D",
    "Control+E",
    "Control+F",
    "Control+H",
    "Control+K",
    "Control+N",
    "Control+O",
    "Control+Option+Command+,",
    "Control+Option+Command+.",
    "Control+Option+Command+8",
    "Control+Option+Command+Power",
    "Control+P",
    "Control+Power",
    "Control+Shift+Power",
    "Command+F5",
];

fn is_reserved_macos_shortcut(hotkey: &str) -> bool {
    let canonical = hotkey_to_canonical(hotkey);
    RESERVED_MACOS_SHORTCUTS
        .iter()
        .any(|&reserved| hotkey_to_canonical(reserved) == canonical)
}

/// Check if hotkey_a is a strict subset of hotkey_b
/// (all keys in a are in b, but b has additional keys)
fn is_strict_subset(a: &str, b: &str) -> bool {
    let parts_a = parse_hotkey_parts(a);
    let parts_b = parse_hotkey_parts(b);
    parts_a.len() < parts_b.len() && parts_a.is_subset(&parts_b)
}

/// Validates a hotkey string (non-empty, not reserved by macOS).
pub fn validate_hotkey(hotkey: &str) -> Result<(), String> {
    if hotkey.trim().is_empty() {
        return Err("Hotkey cannot be empty".to_string());
    }
    if is_reserved_macos_shortcut(hotkey) {
        return Err("This shortcut is reserved by macOS and cannot be used".to_string());
    }
    Ok(())
}

// ============================================================================
// rdev Listener (configurable hotkeys)
// ============================================================================

/// Minimum time between Start and Stop events.
const MIN_PRESS_RELEASE_INTERVAL: Duration = Duration::from_millis(500);

/// Grace period for subset hotkeys — how long to wait for a superset combo
/// before triggering the shorter hotkey.
const SUBSET_GRACE_PERIOD: Duration = Duration::from_millis(150);

/// Result of processing a hotkey event
#[derive(Debug, Clone)]
enum HotkeyCommandResult {
    SendNow(RecordingCommand),
    SendStopAfter(Duration),
    Pending,
}

/// A hotkey activation that is pending (waiting for grace period to expire
/// or for a superset hotkey to take over).
#[derive(Debug, Clone)]
struct PendingHotkey {
    /// The hotkey config string that matched (e.g. "Fn")
    hotkey_config: String,
    /// The command to send if the grace period expires without a superset match
    command: RecordingCommand,
    /// When this pending activation was created
    created_at: Instant,
}

/// Tracks which configured hotkeys are 'active' (pressed)
struct KeyStateTracker {
    /// Hotkey strings that are currently considered active
    active_hotkeys: HashSet<String>,
    /// When the last 'Start' command was sent
    last_press_at: Option<Instant>,
    /// Set of currently physically pressed keys (normalized strings)
    pressed_keys: HashSet<String>,
    /// A hotkey activation waiting for the grace period to expire
    pending_activation: Option<PendingHotkey>,
}

impl KeyStateTracker {
    fn new() -> Self {
        Self {
            active_hotkeys: HashSet::new(),
            last_press_at: None,
            pressed_keys: HashSet::new(),
            pending_activation: None,
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
    fn matches_hotkey(&self, hotkey_config: &str) -> bool {
        let parts = parse_hotkey_parts(hotkey_config);

        if parts.is_empty() {
            return false;
        }

        // Check if all parts are pressed
        parts.iter().all(|k| self.pressed_keys.contains(k))
    }

    /// Check if a hotkey has a superset sibling among all configured hotkeys
    fn has_superset_sibling(
        &self,
        hotkey_config: &str,
        all_recording_hotkeys: &[String],
        all_action_hotkeys: &[String],
    ) -> bool {
        // Check across ALL configured hotkeys (both recording and action)
        for other in all_recording_hotkeys
            .iter()
            .chain(all_action_hotkeys.iter())
        {
            if is_strict_subset(hotkey_config, other) {
                return true;
            }
        }
        false
    }

    /// Process an event against a specific hotkey configuration.
    /// Returns Some(command) if a hotkey should be triggered, None otherwise.
    fn process_event(
        &mut self,
        hotkey_config: &str,
        trigger_key: &str,
        is_press: bool,
        is_action: bool,
        all_recording_hotkeys: &[String],
        all_action_hotkeys: &[String],
    ) -> Option<HotkeyCommandResult> {
        let hotkey_normalized = hotkey_config.trim().to_string();

        if is_press {
            // Check if this hotkey is fully pressed
            if self.matches_hotkey(&hotkey_normalized) {
                // Only trigger if not already active
                if !self.active_hotkeys.contains(&hotkey_normalized) {
                    let cmd = if is_action {
                        RecordingCommand::ActionStart
                    } else {
                        RecordingCommand::Start
                    };

                    // Check if this hotkey has a superset sibling
                    if self.has_superset_sibling(
                        &hotkey_normalized,
                        all_recording_hotkeys,
                        all_action_hotkeys,
                    ) {
                        // Defer activation — store as pending
                        println!(
                            "⏳ Hotkey {} matched but has superset sibling, deferring for {}ms",
                            hotkey_normalized,
                            SUBSET_GRACE_PERIOD.as_millis()
                        );
                        self.pending_activation = Some(PendingHotkey {
                            hotkey_config: hotkey_normalized,
                            command: cmd,
                            created_at: Instant::now(),
                        });
                        return Some(HotkeyCommandResult::Pending);
                    }

                    // No superset sibling — activate immediately
                    self.active_hotkeys.insert(hotkey_normalized.clone());
                    println!("🔑 Hotkey Activated: {}", hotkey_normalized);
                    self.last_press_at = Some(Instant::now());
                    return Some(HotkeyCommandResult::SendNow(cmd));
                }
            }
        } else {
            // RELEASE logic
            // A hotkey is "released" if ANY of its constituent keys are released.
            // If the key being released is part of an active hotkey, we deactivate it.

            // Check if this active hotkey should be released
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

    /// Check if the pending activation's grace period has expired.
    /// If so, activate the pending hotkey and return the command.
    fn check_pending_timeout(&mut self) -> Option<HotkeyCommandResult> {
        if let Some(ref pending) = self.pending_activation {
            if pending.created_at.elapsed() >= SUBSET_GRACE_PERIOD {
                let pending = self.pending_activation.take().unwrap();
                println!(
                    "⏳→🔑 Grace period expired, activating pending hotkey: {}",
                    pending.hotkey_config
                );
                self.active_hotkeys.insert(pending.hotkey_config);
                self.last_press_at = Some(Instant::now());
                return Some(HotkeyCommandResult::SendNow(pending.command));
            }
        }
        None
    }

    /// Cancel the pending activation if a superset hotkey was activated.
    /// Returns true if a pending was cancelled.
    fn cancel_pending_if_superset(&mut self, superset_config: &str) -> bool {
        if let Some(ref pending) = self.pending_activation {
            if is_strict_subset(&pending.hotkey_config, superset_config) {
                println!(
                    "⏳→❌ Cancelling pending hotkey '{}' — superset '{}' matched",
                    pending.hotkey_config, superset_config
                );
                self.pending_activation = None;
                return true;
            }
        }
        false
    }

    /// If the user releases a key that is part of the pending hotkey
    /// before the grace period expires, immediately activate the pending hotkey.
    fn flush_pending_on_release(&mut self, released_key: &str) -> Option<HotkeyCommandResult> {
        if let Some(ref pending) = self.pending_activation {
            let parts = parse_hotkey_parts(&pending.hotkey_config);
            if parts.contains(&released_key.to_string()) {
                let pending = self.pending_activation.take().unwrap();
                println!(
                    "⏳→🔑 Key released during grace period, flushing pending hotkey: {}",
                    pending.hotkey_config
                );
                self.active_hotkeys.insert(pending.hotkey_config.clone());
                self.last_press_at = Some(Instant::now());
                // Return the start command, then immediately process the release
                return Some(HotkeyCommandResult::SendNow(pending.command));
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

            // 3. Get current hotkey configs
            let recording_hotkeys = config_rx_for_rdev.borrow().clone();
            let action_hotkeys = action_hotkey_rx_for_rdev.borrow().clone();

            // 4. Check for pending timeout (grace period expiry)
            if let Some(result) = tracker.check_pending_timeout() {
                dispatch_command(
                    &result,
                    &recording_tx_for_rdev,
                    true,
                    &key_state_tracker_local,
                );
            }

            // 5. If releasing a key, check if we need to flush a pending hotkey
            if !is_press {
                if let Some(start_result) = tracker.flush_pending_on_release(&key_str) {
                    // The pending hotkey was flushed (started), now process the release
                    dispatch_command(
                        &start_result,
                        &recording_tx_for_rdev,
                        false,
                        &key_state_tracker_local,
                    );
                    // Fall through to process the release against active hotkeys
                }
            }

            // 6. Check Action Hotkeys first (higher priority)
            let mut triggered_action_cmd = None;
            for hotkey in &action_hotkeys {
                if let Some(cmd) = tracker.process_event(
                    hotkey,
                    &key_str,
                    is_press,
                    true,
                    &recording_hotkeys,
                    &action_hotkeys,
                ) {
                    // If this is a superset of a pending hotkey, cancel the pending
                    tracker.cancel_pending_if_superset(hotkey);
                    triggered_action_cmd = Some(cmd);
                    break;
                }
            }

            // 7. Check Recording Hotkeys
            let mut triggered_rec_cmd = None;
            if triggered_action_cmd.is_none() {
                for hotkey in &recording_hotkeys {
                    if let Some(cmd) = tracker.process_event(
                        hotkey,
                        &key_str,
                        is_press,
                        false,
                        &recording_hotkeys,
                        &action_hotkeys,
                    ) {
                        // If this is a superset of a pending hotkey, cancel the pending
                        tracker.cancel_pending_if_superset(hotkey);
                        triggered_rec_cmd = Some(cmd);
                        break;
                    }
                }
            }

            // 8. Dispatch Commands
            let cmd_to_send = triggered_action_cmd.clone().or(triggered_rec_cmd);
            let is_action_triggered = triggered_action_cmd.is_some();

            if let Some(result) = cmd_to_send {
                dispatch_command(
                    &result,
                    &recording_tx_for_rdev,
                    is_action_triggered,
                    &key_state_tracker_local,
                );
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

/// Helper to dispatch a HotkeyCommandResult to the recording channel
fn dispatch_command(
    result: &HotkeyCommandResult,
    tx: &mpsc::Sender<RecordingCommand>,
    is_action: bool,
    tracker_arc: &Arc<Mutex<KeyStateTracker>>,
) {
    match result {
        HotkeyCommandResult::SendNow(cmd) => {
            if let Err(e) = tx.send(*cmd) {
                eprintln!("Failed to send command: {:?}", e);
            }
        }
        HotkeyCommandResult::SendStopAfter(delay) => {
            let tx = tx.clone();
            let delay = *delay;
            let stop_cmd = if is_action {
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
        HotkeyCommandResult::Pending => {
            let tx = tx.clone();
            let tracker = tracker_arc.clone();
            std::thread::spawn(move || {
                std::thread::sleep(SUBSET_GRACE_PERIOD);
                // After sleep, check if pending is still valid and timed out
                let mut t = tracker.lock().unwrap();
                if let Some(res) = t.check_pending_timeout() {
                    if let HotkeyCommandResult::SendNow(cmd) = res {
                        if let Err(e) = tx.send(cmd) {
                            eprintln!("Failed to send pending command: {:?}", e);
                        }
                    }
                }
            });
        }
    }
}
