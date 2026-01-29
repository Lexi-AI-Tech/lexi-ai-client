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
        // Reduced from 50ms to 16ms (~1 frame at 60fps) for more responsive feel
        // Still prevents double-triggering from hardware bounce
        const MIN_STATE_DURATION: Duration = Duration::from_millis(16);

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

/// Checks if a keyboard event matches any of the configured rdev hotkeys
/// Returns true if the event should trigger recording
fn matches_rdev_hotkey(event_type: &EventType, rdev_hotkeys: &[String]) -> bool {
    for hotkey in rdev_hotkeys {
        let trimmed = hotkey.trim();

        // Check for Fn key
        if trimmed.eq_ignore_ascii_case("Fn") {
            if matches!(
                event_type,
                EventType::KeyPress(Key::Function) | EventType::KeyRelease(Key::Function)
            ) {
                return true;
            }
        }

        // For other rdev hotkeys, we'd need to parse and match
        // Currently only Fn is supported via rdev, others go to Tauri
        // This can be extended in the future for modifier-only or single-key hotkeys
    }

    false
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
/// * `config_rx` - Watch receiver for hotkey config changes (from AppConfig.hotkeys)
/// * `recording_state` - Shared state to check if we're in hotkey recording mode
pub fn start_listener(
    app: AppHandle,
    recording_tx: mpsc::Sender<RecordingCommand>,
    config_rx: watch::Receiver<Vec<String>>,
    recording_state: Arc<Mutex<bool>>,
) {
    let app_for_rdev = app.clone();
    let recording_tx_for_rdev = recording_tx.clone();
    let recording_state_for_rdev = recording_state.clone();
    let config_rx_for_rdev = config_rx.clone();

    // Key state tracker to prevent spurious/duplicate events
    let key_state_tracker = Arc::new(Mutex::new(KeyStateTracker::new()));

    // Watchdog thread: Monitors the rdev listener and respawns it if it crashes
    // Each retry spawns a NEW thread to avoid system-level hook conflicts
    std::thread::spawn(move || {
        const MAX_RETRIES: u32 = 5;
        let mut retry_count = 0;
        let mut backoff_seconds = 2;

        loop {
            println!(
                "🔑 Starting rdev listener (attempt {}/{})",
                retry_count + 1,
                MAX_RETRIES + 1
            );

            // Clone everything needed for this attempt's callback
            let app_for_attempt = app_for_rdev.clone();
            let recording_tx_for_attempt = recording_tx_for_rdev.clone();
            let recording_state_for_attempt = recording_state_for_rdev.clone();
            let config_rx_for_attempt = config_rx_for_rdev.clone();
            let key_state_tracker_for_attempt = key_state_tracker.clone();

            // Spawn listener in a NEW thread (critical for recovery)
            // This ensures each attempt gets a fresh thread context
            let listener_handle = std::thread::spawn(move || {
                let callback = move |event: Event| {
                    // Check if we're in hotkey recording mode (for UI hotkey selection)
                    let is_recording = recording_state_for_attempt
                        .lock()
                        .map(|guard| *guard)
                        .unwrap_or(false);

                    // If in recording mode, emit key events to frontend for hotkey selection
                    if is_recording {
                        match &event.event_type {
                            EventType::KeyPress(ref key) => {
                                let key_str = key_to_string(key);
                                let _ = app_for_attempt.emit(
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
                    let current_hotkeys = config_rx_for_attempt.borrow().clone();
                    let current_rdev_hotkeys = rdev_hotkeys(&current_hotkeys);

                    // Check if this event matches any configured rdev hotkey
                    let command = if matches_rdev_hotkey(&event.event_type, &current_rdev_hotkeys) {
                        // For Fn key, use the state tracker (press/release behavior)
                        if matches!(
                            &event.event_type,
                            EventType::KeyPress(Key::Function)
                                | EventType::KeyRelease(Key::Function)
                        ) {
                            // Use state tracker for Fn key
                            if let Ok(mut tracker) = key_state_tracker_for_attempt.lock() {
                                tracker.process_event(&event.event_type)
                            } else {
                                eprintln!("❌ Failed to lock key state tracker");
                                None
                            }
                        } else {
                            // For other rdev hotkeys (modifier-only, single keys, etc.)
                            // This can be extended in the future
                            None
                        }
                    } else {
                        None
                    };

                    // Process command if we got one
                    if let Some(command) = command {
                        let trigger_type = match command {
                            RecordingCommand::Start => "PRESSED",
                            RecordingCommand::Stop => "RELEASED",
                        };
                        println!("=== HOTKEY TRIGGER: {} ===", trigger_type);

                        // CRITICAL: Send recording command IMMEDIATELY for responsive UI
                        // This is the hot path - no blocking operations here
                        if let Err(e) = recording_tx_for_attempt.send(command) {
                            eprintln!("Failed to send recording signal: {:?}", e);
                        }

                        // Query cursor context asynchronously (non-blocking)
                        // This runs in background and doesn't delay recording start
                        std::thread::spawn(|| {
                            if let Some(context) = crate::cursor_context::get_cursor_context() {
                                println!(
                                    "Cursor context - App: {:?}, PID: {:?}, Text: {:?}",
                                    context.app_name, context.pid, context.selected_text
                                );
                            }
                        });

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

                        // NOTE: Don't emit recording_started/recording_stopped here anymore.
                        // The recording_thread.rs now handles this AFTER actual recording starts/stops.
                        // This prevents race conditions where UI updates before audio stream is ready.
                    }

                    // Emit all keyboard events for debug (commented out by default)
                    if let Some(event_string) = event_type_to_string(&event.event_type) {
                        // println!("Keyboard event: {:?}", event);
                        if let Err(e) = app_for_attempt.emit("global-input", &event_string) {
                            eprintln!("Failed to emit event: {:?}", e);
                        }
                    }
                };

                // This blocks until crash or app exit
                listen(callback)
            });

            // Wait for the listener thread to complete (which means it crashed or exited)
            match listener_handle.join() {
                Ok(Ok(())) => {
                    // Clean exit - listener stopped gracefully (e.g., app shutdown)
                    println!("✅ rdev listener stopped cleanly");
                    break;
                }
                Ok(Err(error)) => {
                    // listen() returned an error
                    eprintln!("❌ rdev listener crashed: {:?}", error);

                    retry_count += 1;
                    if retry_count >= MAX_RETRIES {
                        eprintln!(
                            "🛑 Max retries ({}) reached. Global keyboard shortcuts disabled.",
                            MAX_RETRIES
                        );
                        eprintln!("   This usually means Input Monitoring permission is missing.");
                        eprintln!(
                            "   Check: System Settings > Privacy & Security > Input Monitoring"
                        );
                        break;
                    }

                    // Exponential backoff before retry (2s, 4s, 8s, 16s, 32s, capped at 60s)
                    eprintln!(
                        "🔄 Retrying in {}s... ({}/{} attempts remaining)",
                        backoff_seconds,
                        MAX_RETRIES - retry_count,
                        MAX_RETRIES
                    );
                    std::thread::sleep(Duration::from_secs(backoff_seconds));
                    backoff_seconds = (backoff_seconds * 2).min(60); // Cap at 60 seconds
                }
                Err(e) => {
                    // Thread panicked
                    eprintln!("❌ rdev listener thread panicked: {:?}", e);
                    eprintln!("🛑 Global keyboard shortcuts disabled.");
                    break;
                }
            }
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
