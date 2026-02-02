//! Global Keyboard Listener and Shortcut Manager Module
//!
//! This module provides unified hotkey management using both:
//! - **rdev** for Fn key detection (low-level, requires Input Monitoring permission)
//! - **Tauri global shortcuts** for other hotkeys (modifier + key combinations)
//!
//! ## Features
//!
//! - **Function Key Hotkey**: Supports Function (Fn) key via rdev (hardware-handled on macOS)
//! - **Tauri Global Shortcuts**: Supports modifier + key combinations via Tauri plugin
//! - **Dynamic Configuration**: Hotkey config can be changed at runtime (up to 3 hotkeys)
//! - **Hotkey Recording Mode**: Emits key events to frontend for interactive hotkey selection
//! - **System Shortcut Validation**: Prevents registration of system-reserved shortcuts
//!
//! ## Architecture
//!
//! The listener runs two threads:
//! 1. **rdev listener thread**: Always running, reads hotkeys dynamically from AppConfig on each event
//! 2. **Manager thread**: Watches config changes and handles Tauri global shortcut registration/unregistration
//!
//! When hotkeys change:
//! - rdev listener automatically sees new hotkeys (reads from config on each event)
//! - Manager thread unregisters old Tauri shortcuts and registers new ones
//!
//! ## Permissions Required
//!
//! - **Input Monitoring** (macOS): Required for `rdev::listen` to work system-wide
//!
//! ## Limitations
//!
//! Tauri global shortcuts cannot detect:
//! - Modifier-only shortcuts (Cmd, Shift, Ctrl, Alt alone)
//! - System-reserved shortcuts (Cmd+Space, Cmd+Tab, etc.)
//! - Fn key (handled separately via rdev)
//! - Media keys (volume, brightness, etc.)
//!
//! This module validates and rejects such shortcuts.

use crate::RecordingCommand;
use rdev::{listen, Event, EventType, Key};
use std::collections::HashSet;
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};
use tokio::sync::watch;

// ============================================================================
// Hotkey Helper Functions
// ============================================================================
// These functions work directly with Vec<String> from AppConfig.hotkeys
// which is the single source of truth stored in Tauri Store.

/// Returns hotkeys that should be handled by rdev (Fn key or keys that can't use Tauri)
pub fn rdev_hotkeys(hotkeys: &[String]) -> Vec<String> {
    hotkeys
        .iter()
        .filter(|h| {
            let trimmed = h.trim();
            trimmed.eq_ignore_ascii_case("Fn") || should_use_rdev(trimmed)
        })
        .cloned()
        .collect()
}

/// Returns hotkeys that should use Tauri global shortcuts
pub fn tauri_hotkeys(hotkeys: &[String]) -> Vec<String> {
    hotkeys
        .iter()
        .filter(|h| {
            let trimmed = h.trim();
            !trimmed.eq_ignore_ascii_case("Fn") && !should_use_rdev(trimmed)
        })
        .cloned()
        .collect()
}

// ============================================================================
// System Shortcut Validation
// ============================================================================

/// macOS system-reserved shortcuts that cannot be registered
/// These are intercepted by macOS before Tauri sees them
const SYSTEM_RESERVED_SHORTCUTS: &[&str] = &[
    // Spotlight and system navigation
    "CommandOrControl+Space",     // Spotlight
    "CommandOrControl+Tab",       // App switcher
    "CommandOrControl+Shift+Tab", // Reverse app switcher
    "CommandOrControl+`",         // Window switcher
    "CommandOrControl+Shift+`",   // Reverse window switcher
    // Application control
    "CommandOrControl+H",          // Hide app
    "CommandOrControl+M",          // Minimize window
    "CommandOrControl+W",          // Close window
    "CommandOrControl+Q",          // Quit app
    "CommandOrControl+Option+Esc", // Force Quit
    "CommandOrControl+Control+Q",  // Lock Screen
    // Text editing (system-level)
    "CommandOrControl+C",       // Copy
    "CommandOrControl+V",       // Paste
    "CommandOrControl+X",       // Cut
    "CommandOrControl+A",       // Select All
    "CommandOrControl+Z",       // Undo
    "CommandOrControl+Shift+Z", // Redo
    // System dialogs
    "CommandOrControl+Comma",  // Preferences
    "CommandOrControl+Period", // Settings (some apps)
    // Mission Control and Spaces
    "CommandOrControl+Up",    // Mission Control
    "CommandOrControl+Down",  // Application windows
    "CommandOrControl+Left",  // Previous space
    "CommandOrControl+Right", // Next space
    "CommandOrControl+1",     // Switch to desktop 1
    "CommandOrControl+2",     // Switch to desktop 2
    "CommandOrControl+3",     // Switch to desktop 3
    // Screenshots
    "CommandOrControl+Shift+3", // Screenshot
    "CommandOrControl+Shift+4", // Screenshot selection
    "CommandOrControl+Shift+5", // Screenshot options
    // Finder
    "CommandOrControl+N",            // New window
    "CommandOrControl+T",            // New tab
    "CommandOrControl+Delete",       // Move to Trash
    "CommandOrControl+Shift+Delete", // Empty Trash
];

/// Checks if a hotkey should be handled by rdev instead of Tauri global shortcuts
/// Returns true for keys that Tauri cannot handle reliably
pub fn should_use_rdev(hotkey: &str) -> bool {
    let trimmed = hotkey.trim();

    // Fn key must use rdev
    if trimmed.eq_ignore_ascii_case("Fn") {
        return true;
    }

    // Normalize for checking
    let normalized = normalize_hotkey(trimmed);

    // Check if it's modifier-only (Tauri can't handle, but rdev can)
    if let Ok(shortcut) = normalized.parse::<Shortcut>() {
        if is_modifier_only(&shortcut, &normalized) {
            return true;
        }
    }

    // Check if it's a single key without modifiers (risky with Tauri, better with rdev)
    if is_single_key_without_modifiers(&normalized) {
        return true;
    }

    false
}

/// Validates a hotkey string and returns an error if it's invalid
/// Note: Keys that can't use Tauri will be handled by rdev automatically
pub fn validate_hotkey(hotkey: &str) -> Result<(), String> {
    let trimmed = hotkey.trim();

    // Fn key is always valid (handled by rdev)
    if trimmed.eq_ignore_ascii_case("Fn") {
        return Ok(());
    }

    // If it should use rdev, it's valid (rdev can handle more keys)
    if should_use_rdev(trimmed) {
        return Ok(());
    }

    // For Tauri shortcuts, check if it's system-reserved
    let normalized = normalize_hotkey(trimmed);

    // System-reserved shortcuts cannot be overridden even with rdev
    // (macOS intercepts them before any app sees them)
    if SYSTEM_RESERVED_SHORTCUTS
        .iter()
        .any(|&reserved| reserved.eq_ignore_ascii_case(&normalized))
    {
        return Err(format!(
            "Hotkey '{}' is reserved by macOS and cannot be used. Please choose a different combination.",
            hotkey
        ));
    }

    // Try to parse as Tauri shortcut to validate format
    let _shortcut: Shortcut = normalized
        .parse()
        .map_err(|e| format!("Invalid hotkey format '{}': {}", hotkey, e))?;

    Ok(())
}

/// Checks if a shortcut is modifier-only
fn is_modifier_only(_shortcut: &Shortcut, normalized: &str) -> bool {
    // Check if the normalized string contains only modifiers
    let parts: Vec<&str> = normalized.split('+').collect();
    let modifier_count = parts.iter().filter(|p| is_modifier_key(p)).count();

    // If all parts are modifiers, it's modifier-only
    modifier_count == parts.len() && !parts.is_empty()
}

/// Checks if a hotkey is a single key without modifiers
fn is_single_key_without_modifiers(normalized: &str) -> bool {
    let parts: Vec<&str> = normalized.split('+').collect();
    parts.len() == 1 && !is_modifier_key(parts[0])
}

/// Checks if a key string is a modifier
fn is_modifier_key(key: &str) -> bool {
    matches!(
        key.to_lowercase().as_str(),
        "commandorcontrol"
            | "command"
            | "control"
            | "ctrl"
            | "alt"
            | "option"
            | "shift"
            | "meta"
            | "super"
    )
}

// ============================================================================
// Hotkey Normalization
// ============================================================================

/// Normalize a hotkey string to Tauri global shortcut format
/// Converts frontend key names (e.g., "Cmd+Shift+R") to Tauri format (e.g., "CommandOrControl+Shift+R")
pub fn normalize_hotkey(hotkey: &str) -> String {
    hotkey
        .split('+')
        .map(|key_str| normalize_single_key(key_str.trim()))
        .collect::<Vec<_>>()
        .join("+")
}

/// Normalize a single key string
fn normalize_single_key(key: &str) -> String {
    match key.to_lowercase().as_str() {
        "cmd" | "command" | "meta" | "super" => "CommandOrControl".to_string(),
        "ctrl" | "control" => "Control".to_string(),
        "option" | "alt" => "Alt".to_string(),
        "shift" => "Shift".to_string(),
        "space" => "Space".to_string(),
        "return" => "Enter".to_string(),
        "arrowup" => "Up".to_string(),
        "arrowdown" => "Down".to_string(),
        "arrowleft" => "Left".to_string(),
        "arrowright" => "Right".to_string(),
        _ => {
            // For single letter keys, uppercase them
            if key.len() == 1 && key.chars().all(|c| c.is_alphabetic()) {
                key.to_uppercase()
            } else {
                key.to_string()
            }
        }
    }
}

// ============================================================================
// Tauri Global Shortcut Management
// ============================================================================

/// Register a hotkey, trying Tauri first, falling back to rdev if needed
/// Returns (success, used_rdev) tuple
pub fn register_hotkey(app: &AppHandle, hotkey: &str) -> Result<bool, String> {
    let trimmed = hotkey.trim();

    // Validate the hotkey
    validate_hotkey(trimmed)?;

    // If it should use rdev, mark it for rdev handling
    if should_use_rdev(trimmed) {
        println!(
            "🔑 Hotkey '{}' will be handled by rdev (not supported by Tauri global shortcuts)",
            trimmed
        );
        return Ok(true); // true = use rdev
    }

    // Try to register with Tauri global shortcuts
    let normalized = normalize_hotkey(trimmed);
    println!(
        "🔑 Attempting to register Tauri global shortcut: {} (normalized: {})",
        trimmed, normalized
    );

    // Parse the normalized shortcut
    let shortcut: Shortcut = match normalized.parse() {
        Ok(s) => s,
        Err(e) => {
            // If parsing fails, fall back to rdev
            println!(
                "⚠️  Failed to parse hotkey '{}' for Tauri, will use rdev: {}",
                trimmed, e
            );
            return Ok(true); // Use rdev
        }
    };

    // Try to register with Tauri
    match app.global_shortcut().register(shortcut) {
        Ok(_) => {
            println!(
                "✅ Successfully registered Tauri global shortcut: {}",
                trimmed
            );
            Ok(false) // false = using Tauri
        }
        Err(e) => {
            let error_msg = e.to_string();
            let error_lower = error_msg.to_lowercase();

            // If it's a conflict or already in use, that's a real error
            if error_lower.contains("already registered")
                || error_lower.contains("conflict")
                || error_lower.contains("in use")
            {
                Err(format!("Hotkey '{}' is already in use by another application. Please choose a different combination.", trimmed))
            } else {
                // For other errors, fall back to rdev
                println!(
                    "⚠️  Failed to register '{}' with Tauri ({}), will use rdev instead",
                    trimmed, e
                );
                Ok(true) // Use rdev
            }
        }
    }
}

/// Unregister a hotkey (only for Tauri shortcuts, rdev hotkeys are handled by config change)
pub fn unregister_hotkey(app: &AppHandle, hotkey: &str) -> Result<(), String> {
    let trimmed = hotkey.trim();

    // Skip rdev-handled keys (they're managed by the rdev listener)
    if should_use_rdev(trimmed) {
        return Ok(());
    }

    let normalized = normalize_hotkey(trimmed);
    println!(
        "🔑 Unregistering Tauri global shortcut: {} (normalized: {})",
        trimmed, normalized
    );

    let shortcut: Shortcut = normalized.parse().map_err(|e| {
        format!(
            "Failed to parse hotkey '{}' (normalized: '{}'): {}",
            trimmed, normalized, e
        )
    })?;

    app.global_shortcut()
        .unregister(shortcut)
        .map_err(|e| format!("Failed to unregister hotkey '{}': {}", trimmed, e))?;

    println!(
        "✅ Successfully unregistered Tauri global shortcut: {}",
        trimmed
    );
    Ok(())
}

/// Register multiple hotkeys (up to 3)
/// Returns list of hotkeys that will be handled by rdev
pub fn register_hotkeys(app: &AppHandle, hotkeys: &[String]) -> Result<Vec<String>, String> {
    // Limit to 3 hotkeys
    if hotkeys.len() > 3 {
        return Err("Maximum of 3 hotkeys allowed".to_string());
    }

    let mut rdev_hotkeys = Vec::new();
    let mut errors = Vec::new();

    for hotkey in hotkeys {
        match register_hotkey(app, hotkey) {
            Ok(use_rdev) => {
                if use_rdev {
                    rdev_hotkeys.push(hotkey.clone());
                }
            }
            Err(e) => {
                errors.push(format!("Failed to register '{}': {}", hotkey, e));
            }
        }
    }

    if !errors.is_empty() {
        return Err(errors.join("; "));
    }

    Ok(rdev_hotkeys)
}

/// Unregister all Tauri hotkeys (rdev hotkeys are managed by config)
pub fn unregister_all_hotkeys(app: &AppHandle, hotkeys: &[String]) {
    for hotkey in hotkeys {
        // Only unregister Tauri shortcuts, rdev ones are handled by listener restart
        if !should_use_rdev(hotkey) {
            if let Err(e) = unregister_hotkey(app, hotkey) {
                eprintln!("⚠️  Failed to unregister hotkey '{}': {}", hotkey, e);
            }
        }
    }
}

// ============================================================================
// rdev Listener (configurable hotkeys)
// ============================================================================

/// Minimum time between Start and Stop events. If user releases before this, we send Stop after the remaining delay.
const MIN_PRESS_RELEASE_INTERVAL: Duration = Duration::from_millis(500);

/// Result of processing a hotkey event: either send a command now or send Stop after a delay.
enum HotkeyCommandResult {
    SendNow(RecordingCommand),
    /// Send Stop after this duration (user released before MIN_PRESS_RELEASE_INTERVAL).
    SendStopAfter(Duration),
}

/// Tracks which configured rdev hotkeys are currently pressed (set-based).
/// Keys are identified by the hotkey string from config (e.g. "Fn").
/// Insert on KeyPress, remove on KeyRelease; duplicate events are ignored.
/// At least MIN_PRESS_RELEASE_INTERVAL must pass between Start and Stop — if user releases sooner, Stop is sent after the remaining time.
struct KeyStateTracker {
    /// Hotkey strings that are currently considered pressed (we saw KeyPress, not yet KeyRelease).
    pressed_hotkeys: HashSet<String>,
    /// When we last sent Start (key pressed); used to enforce minimum time before Stop.
    last_press_at: Option<Instant>,
}

impl KeyStateTracker {
    fn new() -> Self {
        Self {
            pressed_hotkeys: HashSet::new(),
            last_press_at: None,
        }
    }

    /// Returns a result when we should send a command (now or after delay).
    /// Start when hotkey is newly pressed; Stop when released, either now or after delay so that at least MIN_PRESS_RELEASE_INTERVAL has passed since Start.
    fn process_event(&mut self, hotkey: &str, is_press: bool) -> Option<HotkeyCommandResult> {
        let key = hotkey.trim().to_string();
        if is_press {
            // "Insert" — only emit Start if hotkey wasn't already in pressed set
            if self.pressed_hotkeys.insert(key.clone()) {
                println!("🔑 Key state: {} pressed", key);
                self.last_press_at = Some(Instant::now());
                Some(HotkeyCommandResult::SendNow(RecordingCommand::Start))
            } else {
                println!("⚠️  Ignoring duplicate KeyPress ({} already pressed)", key);
                None
            }
        } else {
            // "Remove" — only emit Stop if hotkey was in pressed set
            if self.pressed_hotkeys.remove(&key) {
                println!("🔑 Key state: {} released", key);
                let elapsed = self
                    .last_press_at
                    .map(|t| t.elapsed())
                    .unwrap_or(MIN_PRESS_RELEASE_INTERVAL);
                if elapsed >= MIN_PRESS_RELEASE_INTERVAL {
                    Some(HotkeyCommandResult::SendNow(RecordingCommand::Stop))
                } else {
                    let remaining = MIN_PRESS_RELEASE_INTERVAL - elapsed;
                    println!(
                        "⏱️  Release before {:.1}s — will send Stop in {:.2}s",
                        MIN_PRESS_RELEASE_INTERVAL.as_secs_f64(),
                        remaining.as_secs_f64()
                    );
                    Some(HotkeyCommandResult::SendStopAfter(remaining))
                }
            } else {
                println!(
                    "⚠️  Ignoring duplicate KeyRelease ({} already released)",
                    key
                );
                None
            }
        }
    }

    /// Process action hotkey events (returns ActionStart/ActionStop instead of Start/Stop)
    fn process_action_event(
        &mut self,
        hotkey: &str,
        is_press: bool,
    ) -> Option<HotkeyCommandResult> {
        let key = hotkey.trim().to_string();
        if is_press {
            // "Insert" — only emit ActionStart if hotkey wasn't already in pressed set
            if self.pressed_hotkeys.insert(key.clone()) {
                println!("🎯 Action key state: {} pressed", key);
                self.last_press_at = Some(Instant::now());
                Some(HotkeyCommandResult::SendNow(RecordingCommand::ActionStart))
            } else {
                println!(
                    "⚠️  Ignoring duplicate KeyPress (action {} already pressed)",
                    key
                );
                None
            }
        } else {
            // "Remove" — only emit ActionStop if hotkey was in pressed set
            if self.pressed_hotkeys.remove(&key) {
                println!("🎯 Action key state: {} released", key);
                let elapsed = self
                    .last_press_at
                    .map(|t| t.elapsed())
                    .unwrap_or(MIN_PRESS_RELEASE_INTERVAL);
                if elapsed >= MIN_PRESS_RELEASE_INTERVAL {
                    Some(HotkeyCommandResult::SendNow(RecordingCommand::ActionStop))
                } else {
                    let remaining = MIN_PRESS_RELEASE_INTERVAL - elapsed;
                    println!(
                        "⏱️  Action release before {:.1}s — will send ActionStop in {:.2}s",
                        MIN_PRESS_RELEASE_INTERVAL.as_secs_f64(),
                        remaining.as_secs_f64()
                    );
                    Some(HotkeyCommandResult::SendStopAfter(remaining))
                }
            } else {
                println!(
                    "⚠️  Ignoring duplicate KeyRelease (action {} already released)",
                    key
                );
                None
            }
        }
    }
}

/// Maps an rdev event to the configured hotkey it matches and whether it's press or release.
/// Returns None if the event doesn't match any configured rdev hotkey.
/// Maps an rdev event to the configured hotkey it matches and whether it's press or release.
/// Returns None if the event doesn't match any configured rdev hotkey.
fn event_to_rdev_hotkey_action(
    event_type: &EventType,
    rdev_hotkeys: &[String],
) -> Option<(String, bool)> {
    let (key, is_press) = match event_type {
        EventType::KeyPress(k) => (k, true),
        EventType::KeyRelease(k) => (k, false),
        _ => return None,
    };

    let event_key_str = key_to_string(key);

    for hotkey in rdev_hotkeys {
        let trimmed = hotkey.trim();
        let normalized_config = normalize_rdev_string(trimmed);

        // Debug prints for troubleshooting
        // println!("Comparing config '{}' (norm: '{}') with event '{}'", trimmed, normalized_config, event_key_str);

        if normalized_config == event_key_str {
            return Some((trimmed.to_string(), is_press));
        }
    }

    None
}

/// Helper to convert keyboard EventType to a string for frontend emission
/// Only handles keyboard events (KeyPress and KeyRelease)
fn event_type_to_string(event_type: &EventType) -> Option<String> {
    match event_type {
        EventType::KeyPress(key) => Some(format!("key_press: {:?}", key)),
        EventType::KeyRelease(key) => Some(format!("key_release: {:?}", key)),
        _ => None, // Ignore mouse events
    }
}

/// Convert rdev Key to string representation for frontend
/// Normalizes key names to match frontend expectations
/// Convert rdev Key to string representation for frontend/logic
/// Normalizes key names to match frontend expectations and our internal normalization
fn key_to_string(key: &Key) -> String {
    match key {
        Key::MetaLeft | Key::MetaRight => "Command".to_string(),
        Key::ControlLeft | Key::ControlRight => "Control".to_string(),
        Key::Alt => "Option".to_string(),
        Key::ShiftLeft | Key::ShiftRight => "Shift".to_string(),
        Key::Function => "Fn".to_string(),
        _ => format!("{:?}", key),
    }
}

/// Normalize config hotkey string for rdev comparison
/// Maps "cmd", "command" -> "Command", etc. to match key_to_string output
fn normalize_rdev_string(key: &str) -> String {
    match key.to_lowercase().as_str() {
        "cmd" | "command" | "meta" | "super" => "Command".to_string(),
        "ctrl" | "control" => "Control".to_string(),
        "option" | "alt" => "Option".to_string(),
        "shift" => "Shift".to_string(),
        "fn" => "Fn".to_string(),
        _ => {
            // For single letter keys, uppercase them
            if key.len() == 1 && key.chars().all(|c| c.is_alphabetic()) {
                key.to_uppercase()
            } else {
                // Return as is for others (assuming config matches Debug output casing usually)
                key.to_string()
            }
        }
    }
}

/// Starts the global keyboard listener with dynamic config support.
///
/// This spawns two threads:
/// 1. **rdev listener thread**: Always running, reads hotkeys dynamically from config on each event
/// 2. **Manager thread**: Watches config changes and handles Tauri global shortcut registration/unregistration
///
/// # Arguments
/// * `app` - The Tauri AppHandle used to emit events to the frontend
/// * `recording_tx` - Channel sender to signal start/stop recording
/// * `action_tx` - Channel sender to signal action hotkey press/release
/// * `config_rx` - Watch receiver for hotkey config changes (from AppConfig.hotkeys)
/// * `action_hotkey_rx` - Watch receiver for action hotkey config changes (from AppConfig.action_hotkey)
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

    // Key state tracker to prevent spurious/duplicate events
    let key_state_tracker = Arc::new(Mutex::new(KeyStateTracker::new()));

    // Start rdev listener thread - always running, reads hotkeys dynamically
    std::thread::spawn(move || {
        let key_state_tracker_for_callback = key_state_tracker.clone();
        let callback = move |event: Event| {
            // Check if we're in hotkey recording mode (for UI hotkey selection)
            let is_recording = recording_state_for_rdev
                .lock()
                .map(|guard| *guard)
                .unwrap_or(false);

            // If in recording mode, emit key events to frontend for hotkey selection
            if is_recording {
                match &event.event_type {
                    EventType::KeyPress(ref key) => {
                        let key_str = key_to_string(key);
                        let _ = app_for_rdev.emit(
                            "hotkey-recorded",
                            serde_json::json!({
                                "key": key_str,
                                "modifiers": []
                            }),
                        );
                    }
                    _ => {}
                }
            }

            // Get current hotkeys from AppConfig (single source of truth: Tauri Store)
            let current_hotkeys = config_rx_for_rdev.borrow().clone();
            let current_rdev_hotkeys = rdev_hotkeys(&current_hotkeys);

            // Get current action hotkeys
            let current_action_hotkeys = action_hotkey_rx_for_rdev.borrow().clone();

            // Check if this event matches the action hotkey first
            let action_result =
                event_to_rdev_hotkey_action(&event.event_type, &current_action_hotkeys).and_then(
                    |(hotkey, is_press)| {
                        key_state_tracker_for_callback
                            .lock()
                            .ok()
                            .and_then(|mut tracker| tracker.process_action_event(&hotkey, is_press))
                    },
                );

            // Process action command if we got one
            if let Some(result) = action_result {
                match &result {
                    HotkeyCommandResult::SendNow(cmd) => {
                        let trigger_type = match cmd {
                            RecordingCommand::ActionStart => "ACTION_PRESSED",
                            RecordingCommand::ActionStop => "ACTION_RELEASED",
                            _ => "UNKNOWN",
                        };
                        println!("=== ACTION HOTKEY TRIGGER: {} ===", trigger_type);
                    }
                    HotkeyCommandResult::SendStopAfter(d) => {
                        println!(
                            "=== ACTION HOTKEY TRIGGER: RELEASED (delayed {:.2}s) ===",
                            d.as_secs_f64()
                        );
                    }
                }

                match result {
                    HotkeyCommandResult::SendNow(command) => {
                        if let Err(e) = recording_tx_for_rdev.send(command) {
                            eprintln!("Failed to send action signal: {:?}", e);
                        }
                        println!(
                            "Action hotkey {} - {} action recording",
                            match command {
                                RecordingCommand::ActionStart => "pressed",
                                RecordingCommand::ActionStop => "released",
                                _ => "unknown",
                            },
                            match command {
                                RecordingCommand::ActionStart => "Starting",
                                RecordingCommand::ActionStop => "Stopping",
                                _ => "Unknown",
                            }
                        );
                    }
                    HotkeyCommandResult::SendStopAfter(delay) => {
                        let tx = recording_tx_for_rdev.clone();
                        std::thread::spawn(move || {
                            std::thread::sleep(delay);
                            if let Err(e) = tx.send(RecordingCommand::ActionStop) {
                                eprintln!("Failed to send delayed ActionStop: {:?}", e);
                            } else {
                                println!(
                                    "Action hotkey released - Stopping action recording (after minimum interval)"
                                );
                            }
                        });
                    }
                }
                return; // Don't process as regular recording hotkey
            }

            // Check if this event matches any configured rdev hotkey; use state tracker for press/release
            let result = event_to_rdev_hotkey_action(&event.event_type, &current_rdev_hotkeys)
                .and_then(|(hotkey, is_press)| {
                    key_state_tracker_for_callback
                        .lock()
                        .ok()
                        .and_then(|mut tracker| tracker.process_event(&hotkey, is_press))
                });

            // Process command if we got one (send now or schedule delayed Stop)
            if let Some(result) = result {
                match &result {
                    HotkeyCommandResult::SendNow(cmd) => {
                        let trigger_type = match cmd {
                            RecordingCommand::Start | RecordingCommand::ActionStart => "PRESSED",
                            RecordingCommand::Stop | RecordingCommand::ActionStop => "RELEASED",
                        };
                        println!("=== HOTKEY TRIGGER: {} ===", trigger_type);
                    }
                    HotkeyCommandResult::SendStopAfter(d) => {
                        println!(
                            "=== HOTKEY TRIGGER: RELEASED (delayed {:.2}s) ===",
                            d.as_secs_f64()
                        );
                    }
                }

                match result {
                    HotkeyCommandResult::SendNow(command) => {
                        if let Err(e) = recording_tx_for_rdev.send(command) {
                            eprintln!("Failed to send recording signal: {:?}", e);
                        }

                        println!(
                            "Hotkey {} - {} recording",
                            match command {
                                RecordingCommand::Start | RecordingCommand::ActionStart =>
                                    "pressed",
                                RecordingCommand::Stop | RecordingCommand::ActionStop => "released",
                            },
                            match command {
                                RecordingCommand::Start | RecordingCommand::ActionStart =>
                                    "Starting",
                                RecordingCommand::Stop | RecordingCommand::ActionStop => "Stopping",
                            }
                        );
                    }
                    HotkeyCommandResult::SendStopAfter(delay) => {
                        let tx = recording_tx_for_rdev.clone();
                        std::thread::spawn(move || {
                            std::thread::sleep(delay);
                            if let Err(e) = tx.send(RecordingCommand::Stop) {
                                eprintln!("Failed to send delayed Stop: {:?}", e);
                            } else {
                                println!(
                                    "Hotkey released - Stopping recording (after minimum interval)"
                                );
                            }
                        });
                    }
                }

                // NOTE: Don't emit recording_started/recording_stopped here anymore.
                // The recording_thread.rs now handles this AFTER actual recording starts/stops.
            }

            // Emit all keyboard events for debug (commented out by default)
            if let Some(event_string) = event_type_to_string(&event.event_type) {
                // println!("Keyboard event: {:?}", event);
                if let Err(e) = app_for_rdev.emit("global-input", &event_string) {
                    eprintln!("Failed to emit event: {:?}", e);
                }
            }
        };

        println!("🔑 Starting rdev listener (always running, reads hotkeys dynamically)");
        if let Err(error) = listen(callback) {
            eprintln!("rdev listen error: {:?}", error);
        }
    });

    // Manager thread: Watches config changes and handles Tauri global shortcut registration
    std::thread::spawn(move || {
        let mut current_tauri_hotkeys: Vec<String> = Vec::new();
        let mut config_rx_manager = config_rx;

        loop {
            // Get current hotkeys from watch channel (single source of truth: AppConfig.hotkeys)
            let hotkeys = config_rx_manager.borrow().clone();

            // Get hotkeys that should use Tauri global shortcuts
            let new_tauri_hotkeys = tauri_hotkeys(&hotkeys);

            // Check if Tauri hotkeys changed
            if new_tauri_hotkeys != current_tauri_hotkeys {
                println!(
                    "🔄 Tauri hotkeys changed: {:?} -> {:?}",
                    current_tauri_hotkeys, new_tauri_hotkeys
                );

                // Unregister old Tauri hotkeys
                if !current_tauri_hotkeys.is_empty() {
                    unregister_all_hotkeys(&app, &current_tauri_hotkeys);
                }

                // Register new Tauri hotkeys
                if !new_tauri_hotkeys.is_empty() {
                    match register_hotkeys(&app, &new_tauri_hotkeys) {
                        Ok(rdev_fallback) => {
                            if !rdev_fallback.is_empty() {
                                println!(
                                    "ℹ️  {} hotkey(s) will be handled by rdev: {:?}",
                                    rdev_fallback.len(),
                                    rdev_fallback
                                );
                            }
                        }
                        Err(e) => {
                            eprintln!("⚠️  Failed to register Tauri global shortcuts: {}", e);
                        }
                    }
                }

                current_tauri_hotkeys = new_tauri_hotkeys;
            }

            // Wait for config change
            let changed_result = if let Ok(handle) = tokio::runtime::Handle::try_current() {
                handle.block_on(config_rx_manager.changed())
            } else {
                match tokio::runtime::Runtime::new() {
                    Ok(rt) => rt.block_on(config_rx_manager.changed()),
                    Err(_) => {
                        eprintln!("❌ Failed to create runtime for config watch");
                        break;
                    }
                }
            };

            if changed_result.is_err() {
                // Channel closed, exit
                break;
            }
        }
    });
}
