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
//! The listener runs in a manager thread that watches for config changes via `config_rx`.
//! When the hotkey config changes, it:
//! - Shuts down the old rdev listener (if Fn key was present)
//! - Unregisters old Tauri global shortcuts
//! - Registers new Tauri global shortcuts (for non-Fn keys)
//! - Starts new rdev listener (if Fn key is present)
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
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use tauri_plugin_global_shortcut::Shortcut;
use tokio::sync::watch;

// ============================================================================
// Hotkey Configuration
// ============================================================================

/// Hotkey configuration supporting up to 3 hotkeys
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct HotkeyConfig {
    /// Array of up to 3 hotkey strings (e.g., ["Fn", "Cmd+Shift+R", "Ctrl+Alt+T"])
    pub hotkeys: Vec<String>,
}

impl Default for HotkeyConfig {
    fn default() -> Self {
        Self {
            hotkeys: vec!["Fn".to_string()],
        }
    }
}

impl HotkeyConfig {
    /// Returns true if any hotkey contains the Fn key
    pub fn has_fn_key(&self) -> bool {
        self.hotkeys.iter().any(|h| h.trim().eq_ignore_ascii_case("Fn"))
    }

    /// Returns hotkeys that are NOT the Fn key (for Tauri global shortcuts)
    pub fn non_fn_hotkeys(&self) -> Vec<String> {
        self.hotkeys
            .iter()
            .filter(|h| !h.trim().eq_ignore_ascii_case("Fn"))
            .cloned()
            .collect()
    }
}

// ============================================================================
// System Shortcut Validation
// ============================================================================

/// macOS system-reserved shortcuts that cannot be registered
/// These are intercepted by macOS before Tauri sees them
const SYSTEM_RESERVED_SHORTCUTS: &[&str] = &[
    // Spotlight and system navigation
    "CommandOrControl+Space",        // Spotlight
    "CommandOrControl+Tab",          // App switcher
    "CommandOrControl+Shift+Tab",     // Reverse app switcher
    "CommandOrControl+`",            // Window switcher
    "CommandOrControl+Shift+`",      // Reverse window switcher
    
    // Application control
    "CommandOrControl+H",            // Hide app
    "CommandOrControl+M",             // Minimize window
    "CommandOrControl+W",             // Close window
    "CommandOrControl+Q",             // Quit app
    "CommandOrControl+Option+Esc",   // Force Quit
    "CommandOrControl+Control+Q",    // Lock Screen
    
    // Text editing (system-level)
    "CommandOrControl+C",             // Copy
    "CommandOrControl+V",             // Paste
    "CommandOrControl+X",             // Cut
    "CommandOrControl+A",             // Select All
    "CommandOrControl+Z",             // Undo
    "CommandOrControl+Shift+Z",      // Redo
    
    // System dialogs
    "CommandOrControl+Comma",         // Preferences
    "CommandOrControl+Period",        // Settings (some apps)
    
    // Mission Control and Spaces
    "CommandOrControl+Up",            // Mission Control
    "CommandOrControl+Down",          // Application windows
    "CommandOrControl+Left",          // Previous space
    "CommandOrControl+Right",         // Next space
    "CommandOrControl+1",             // Switch to desktop 1
    "CommandOrControl+2",             // Switch to desktop 2
    "CommandOrControl+3",             // Switch to desktop 3
    
    // Screenshots
    "CommandOrControl+Shift+3",       // Screenshot
    "CommandOrControl+Shift+4",       // Screenshot selection
    "CommandOrControl+Shift+5",       // Screenshot options
    
    // Finder
    "CommandOrControl+N",             // New window
    "CommandOrControl+T",             // New tab
    "CommandOrControl+Delete",        // Move to Trash
    "CommandOrControl+Shift+Delete",  // Empty Trash
];

/// Validates a hotkey string and returns an error if it's invalid
pub fn validate_hotkey(hotkey: &str) -> Result<(), String> {
    let trimmed = hotkey.trim();
    
    // Skip validation for Fn key (handled separately via rdev)
    if trimmed.eq_ignore_ascii_case("Fn") {
        return Ok(());
    }
    
    // Normalize the hotkey for comparison
    let normalized = normalize_hotkey(trimmed);
    
    // Check if it's a system-reserved shortcut
    if SYSTEM_RESERVED_SHORTCUTS.iter().any(|&reserved| {
        reserved.eq_ignore_ascii_case(&normalized)
    }) {
        return Err(format!(
            "Hotkey '{}' is reserved by macOS and cannot be used. Please choose a different combination.",
            hotkey
        ));
    }
    
    // Parse to check if it's valid Tauri format
    let shortcut: Shortcut = normalized.parse().map_err(|e| {
        format!("Invalid hotkey format '{}': {}", hotkey, e)
    })?;
    
    // Check if it's modifier-only (not allowed by Tauri)
    if is_modifier_only(&shortcut, &normalized) {
        return Err(format!(
            "Modifier-only shortcuts (like '{}') are not supported. Please include at least one non-modifier key.",
            hotkey
        ));
    }
    
    // Check if it's a single key without modifiers (risky, but allow with warning)
    if is_single_key_without_modifiers(&normalized) {
        // We'll allow it but it's not recommended
        // The user will see a warning in the UI
    }
    
    Ok(())
}

/// Checks if a shortcut is modifier-only
fn is_modifier_only(shortcut: &Shortcut, normalized: &str) -> bool {
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
        "commandorcontrol" | "command" | "control" | "ctrl" | "alt" | "option" | "shift" | "meta" | "super"
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

/// Register a hotkey as a Tauri global shortcut (if it's not the Fn key)
pub fn register_hotkey(
    app: &AppHandle,
    hotkey: &str,
) -> Result<(), String> {
    // Skip Fn key - it's handled by rdev
    if hotkey.trim().eq_ignore_ascii_case("Fn") {
        return Ok(());
    }
    
    // Validate the hotkey before registering
    validate_hotkey(hotkey)?;

    let normalized = normalize_hotkey(hotkey);
    println!("🔑 Registering Tauri global shortcut: {} (normalized: {})", hotkey, normalized);

    // Parse the normalized shortcut
    let shortcut: Shortcut = normalized.parse().map_err(|e| {
        format!("Failed to parse hotkey '{}' (normalized: '{}'): {}", hotkey, normalized, e)
    })?;

    // Register the shortcut (handler is set up in main.rs via the plugin builder)
    app.global_shortcut()
        .register(shortcut)
        .map_err(|e| {
            let error_msg = e.to_string();
            let error_lower = error_msg.to_lowercase();
            
            // Provide helpful error message based on error type
            if error_lower.contains("already registered") || error_lower.contains("conflict") || error_lower.contains("in use") {
                format!("Hotkey '{}' is already in use by another application. Please choose a different combination.", hotkey)
            } else if error_lower.contains("parse") || error_lower.contains("invalid") {
                format!("Invalid hotkey combination '{}'. Please use a valid key combination.", hotkey)
            } else {
                format!("Failed to register hotkey '{}': {}", hotkey, e)
            }
        })?;

    println!("✅ Successfully registered Tauri global shortcut: {}", hotkey);
    Ok(())
}

/// Unregister a hotkey
pub fn unregister_hotkey(app: &AppHandle, hotkey: &str) -> Result<(), String> {
    // Skip Fn key - it's handled by rdev
    if hotkey.trim().eq_ignore_ascii_case("Fn") {
        return Ok(());
    }

    let normalized = normalize_hotkey(hotkey);
    println!("🔑 Unregistering Tauri global shortcut: {} (normalized: {})", hotkey, normalized);

    let shortcut: Shortcut = normalized.parse().map_err(|e| {
        format!("Failed to parse hotkey '{}' (normalized: '{}'): {}", hotkey, normalized, e)
    })?;

    app.global_shortcut()
        .unregister(shortcut)
        .map_err(|e| format!("Failed to unregister hotkey '{}': {}", hotkey, e))?;

    println!("✅ Successfully unregistered Tauri global shortcut: {}", hotkey);
    Ok(())
}

/// Register multiple hotkeys (up to 3)
pub fn register_hotkeys(
    app: &AppHandle,
    hotkeys: &[String],
) -> Result<(), String> {
    // Limit to 3 hotkeys
    if hotkeys.len() > 3 {
        return Err("Maximum of 3 hotkeys allowed".to_string());
    }

    let mut errors = Vec::new();
    for hotkey in hotkeys {
        if let Err(e) = register_hotkey(app, hotkey) {
            errors.push(format!("Failed to register '{}': {}", hotkey, e));
        }
    }
    
    if !errors.is_empty() {
        return Err(errors.join("; "));
    }

    Ok(())
}

/// Unregister all hotkeys
pub fn unregister_all_hotkeys(app: &AppHandle, hotkeys: &[String]) {
    for hotkey in hotkeys {
        if let Err(e) = unregister_hotkey(app, hotkey) {
            eprintln!("⚠️  Failed to unregister hotkey '{}': {}", hotkey, e);
        }
    }
}

// ============================================================================
// rdev Listener (for Fn key)
// ============================================================================

/// Tracks the actual state of the Function key to prevent spurious events
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum KeyState {
    Released,
    Pressed,
}

/// Key state tracker to prevent duplicate/spurious events
struct KeyStateTracker {
    state: KeyState,
    last_state_change: Instant,
}

impl KeyStateTracker {
    fn new() -> Self {
        Self {
            state: KeyState::Released,
            last_state_change: Instant::now(),
        }
    }

    /// Returns Some(command) only if this is a valid state transition
    /// Filters out duplicate events and ensures proper Start→Stop ordering
    fn process_event(&mut self, event_type: &EventType) -> Option<RecordingCommand> {
        const MIN_STATE_DURATION: Duration = Duration::from_millis(50);

        match event_type {
            EventType::KeyPress(Key::Function) => {
                // Only transition to Pressed if currently Released
                if self.state == KeyState::Released {
                    let elapsed = self.last_state_change.elapsed();
                    if elapsed >= MIN_STATE_DURATION {
                        self.state = KeyState::Pressed;
                        self.last_state_change = Instant::now();
                        println!("🔑 Key state: Released → Pressed (after {:?})", elapsed);
                        return Some(RecordingCommand::Start);
                    } else {
                        println!(
                            "⚠️  Ignoring rapid KeyPress (only {:?} since last change)",
                            elapsed
                        );
                    }
                } else {
                    // Already pressed - ignore duplicate KeyPress
                    println!("⚠️  Ignoring duplicate KeyPress (key already pressed)");
                }
            }
            EventType::KeyRelease(Key::Function) => {
                // Only transition to Released if currently Pressed
                if self.state == KeyState::Pressed {
                    let elapsed = self.last_state_change.elapsed();
                    if elapsed >= MIN_STATE_DURATION {
                        self.state = KeyState::Released;
                        self.last_state_change = Instant::now();
                        println!("🔑 Key state: Pressed → Released (held for {:?})", elapsed);
                        return Some(RecordingCommand::Stop);
                    } else {
                        println!(
                            "⚠️  Ignoring rapid KeyRelease (only {:?} since press)",
                            elapsed
                        );
                    }
                } else {
                    // Already released - ignore duplicate KeyRelease
                    println!("⚠️  Ignoring duplicate KeyRelease (key already released)");
                }
            }
            _ => {}
        }
        None
    }

    /// Reset state (e.g., when listener restarts)
    fn reset(&mut self) {
        self.state = KeyState::Released;
        self.last_state_change = Instant::now();
        println!("🔑 Key state tracker reset to Released");
    }
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
fn key_to_string(key: &Key) -> String {
    match key {
        Key::MetaLeft | Key::MetaRight => "Command".to_string(),
        Key::ControlLeft | Key::ControlRight => "Control".to_string(),
        Key::Alt => "Option".to_string(),
        Key::ShiftLeft | Key::ShiftRight => "Shift".to_string(),
        _ => format!("{:?}", key),
    }
}

/// Checks if the event is a Function key event (press or release)
/// Returns true if it's a Function key event that should be processed by the state tracker
fn is_function_key_event(event_type: &EventType) -> bool {
    matches!(
        event_type,
        EventType::KeyPress(Key::Function) | EventType::KeyRelease(Key::Function)
    )
}

/// Starts the global keyboard listener in a background thread with dynamic config support.
///
/// This spawns a manager thread that watches for config changes via `config_rx`.
/// On change, it shuts down the old rdev listener and spawns a new one with the updated config.
///
/// # Arguments
/// * `app` - The Tauri AppHandle used to emit events to the frontend
/// * `recording_tx` - Channel sender to signal start/stop recording
/// * `config_rx` - Watch receiver for hotkey config changes
/// * `recording_state` - Shared state to check if we're in hotkey recording mode
pub fn start_listener(
    app: AppHandle,
    recording_tx: mpsc::Sender<RecordingCommand>,
    mut config_rx: watch::Receiver<HotkeyConfig>,
    recording_state: Arc<Mutex<bool>>,
) {
    // Manager thread: Watches config, restarts listener on change
    std::thread::spawn(move || {
        let app_clone = app.clone();
        let recording_tx_clone = recording_tx.clone();
        let recording_state_clone = recording_state.clone();

        loop {
            // Get current config
            let current_config = config_rx.borrow().clone();
            
            // Only start rdev listener if Fn key is in the config
            if !current_config.has_fn_key() {
                println!("🔑 No Fn key in config, skipping rdev listener");
                // Wait for config change
                if config_rx.changed().is_err() {
                    break;
                }
                continue;
            }
            
            println!("🔑 Starting rdev listener for Fn key: {:?}", current_config);

            // Shutdown flag for this listener instance
            let shutdown = Arc::new(AtomicBool::new(false));
            let shutdown_for_callback = shutdown.clone();
            let app_for_callback = app_clone.clone();
            let recording_tx_for_callback = recording_tx_clone.clone();
            let recording_state_for_callback = recording_state_clone.clone();

            // Key state tracker to prevent spurious/duplicate events
            let key_state_tracker = Arc::new(Mutex::new(KeyStateTracker::new()));
            let key_state_tracker_for_callback = key_state_tracker.clone();

            // Spawn the actual rdev listener thread
            let listener_thread = std::thread::spawn(move || {
                let callback = move |event: Event| {
                    if shutdown_for_callback.load(Ordering::Relaxed) {
                        return; // Early exit if shutdown signaled
                    }

                    // Check if we're in hotkey recording mode (for UI hotkey selection)
                    let is_recording = recording_state_for_callback
                        .lock()
                        .map(|guard| *guard)
                        .unwrap_or(false);

                    // If in recording mode, emit key events to frontend for hotkey selection
                    if is_recording {
                        match &event.event_type {
                            EventType::KeyPress(ref key) => {
                                let key_str = key_to_string(key);
                                let _ = app_for_callback.emit(
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

                    // Check if this is a Function key event and process through state tracker
                    if is_function_key_event(&event.event_type) {
                        // Use state tracker to filter spurious/duplicate events
                        let command = {
                            if let Ok(mut tracker) = key_state_tracker_for_callback.lock() {
                                tracker.process_event(&event.event_type)
                            } else {
                                eprintln!("❌ Failed to lock key state tracker");
                                None
                            }
                        };

                        // Only process if state tracker approved the transition
                        if let Some(command) = command {
                            // Log the trigger
                            let trigger_type = match command {
                                RecordingCommand::Start => "PRESSED",
                                RecordingCommand::Stop => "RELEASED",
                            };
                            println!(
                                "=== HOTKEY TRIGGER: {} ({:?}) ===",
                                trigger_type, current_config
                            );

                            // Query cursor context
                            if let Some(context) = crate::cursor_context::get_cursor_context() {
                                println!(
                                    "Cursor context - App: {:?}, PID: {:?}, Text: {:?}",
                                    context.app_name, context.pid, context.selected_text
                                );
                            }

                            println!(
                                "Hotkey {} - {} recording",
                                match command {
                                    RecordingCommand::Start => "pressed",
                                    RecordingCommand::Stop => "released",
                                },
                                match command {
                                    RecordingCommand::Start => "Starting",
                                    RecordingCommand::Stop => "Stopping",
                                }
                            );

                            // Send to recording
                            if let Err(e) = recording_tx_for_callback.send(command) {
                                eprintln!("Failed to send recording signal: {:?}", e);
                            }

                            // Emit to frontend
                            let event_name = match command {
                                RecordingCommand::Start => "recording_started",
                                RecordingCommand::Stop => "recording_stopped",
                            };
                            if let Err(e) = app_for_callback.emit(event_name, ()) {
                                eprintln!("Failed to emit {} event: {:?}", event_name, e);
                            }
                        }
                    }

                    // Emit all keyboard events for debug
                    if let Some(event_string) = event_type_to_string(&event.event_type) {
                        // println!("Keyboard event: {:?}", event);
                        if let Err(e) = app_for_callback.emit("global-input", &event_string) {
                            eprintln!("Failed to emit event: {:?}", e);
                        }
                    }
                };

                if let Err(error) = listen(callback) {
                    eprintln!("rdev listen error: {:?}", error);
                }
            });

            // Wait for config change or channel close
            // Since we're in a blocking std thread, create a small runtime to await the future
            let shutdown_for_wait = shutdown.clone();
            let changed_result = if let Ok(handle) = tokio::runtime::Handle::try_current() {
                handle.block_on(config_rx.changed())
            } else {
                // If no runtime available, create a small one just for this operation
                match tokio::runtime::Runtime::new() {
                    Ok(rt) => rt.block_on(config_rx.changed()),
                    Err(_) => {
                        // Can't create runtime, exit
                        shutdown_for_wait.store(true, Ordering::Relaxed);
                        let _ = listener_thread.join();
                        break;
                    }
                }
            };

            if changed_result.is_err() {
                // Channel closed, shutdown and exit
                shutdown_for_wait.store(true, Ordering::Relaxed);
                let _ = listener_thread.join();
                break;
            }

            // New config available: Shutdown old and loop to restart
            println!("🔄 Hotkey config changed, restarting listener...");
            shutdown.store(true, Ordering::Relaxed);

            // Reset the key state tracker to ensure clean state on restart
            if let Ok(mut tracker) = key_state_tracker.lock() {
                tracker.reset();
            }

            // Unpark the listener thread if blocked (rdev::listen is blocking, but AtomicBool check is polled)
            // Note: rdev doesn't have built-in shutdown; the flag + next event will exit loop implicitly
            let _ = listener_thread.join(); // Wait for clean shutdown
        }
    });
}
