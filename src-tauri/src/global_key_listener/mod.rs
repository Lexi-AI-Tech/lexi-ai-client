//! Global Keyboard Listener and Shortcut Manager Module
//!
//! This module provides unified hotkey management.
//! It supports:
//! - **Function Key**: (Fn)
//! - **Combinations**: (e.g., Command+Shift+O, Fn+Control)
//! - **Single Keys**: (e.g., F6)
//!
//! ## Permissions Required
//!
//! - **Input Monitoring** (macOS) or **Accessibility**

use crate::RecordingCommand;
use std::collections::HashSet;
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::AppHandle;
use tokio::sync::watch;

#[cfg(target_os = "macos")]
mod macos;

// ============================================================================
// Internal Minimal Key Mapper
// ============================================================================

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum Key {
    Command,
    Control,
    Option,
    Shift,
    Fn,
    Space,
    Enter,
    Escape,
    Tab,
    Backspace,
    Delete,
    Unknown(u16),
}

// Convert internal Key to string presentation
pub(crate) fn key_to_string(key: &Key) -> String {
    match key {
        Key::Command => "Command".to_string(),
        Key::Control => "Control".to_string(),
        Key::Option => "Option".to_string(),
        Key::Shift => "Shift".to_string(),
        Key::Fn => "Fn".to_string(),
        Key::Space => "Space".to_string(),
        Key::Enter => "Enter".to_string(),
        Key::Escape => "Escape".to_string(),
        Key::Tab => "Tab".to_string(),
        Key::Backspace => "Backspace".to_string(),
        Key::Delete => "Delete".to_string(),
        Key::Unknown(k) => format!("Keycode_{}", k), // Fallback
    }
}

/// Normalize config hotkey string for comparison
pub(crate) fn normalize_key_string(key: &str) -> String {
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
            if k.len() == 1 && k.chars().all(|c| c.is_alphabetic()) {
                k.to_uppercase()
            } else if k.to_lowercase().starts_with("key") && k.len() > 3 {
                k[3..].to_string()
            } else {
                let mut chars = k.chars();
                match chars.next() {
                    None => String::new(),
                    Some(f) => f.to_uppercase().collect::<String>() + chars.as_str(),
                }
            }
        }
    }
}

pub fn validate_hotkey(hotkey: &str) -> Result<(), String> {
    if hotkey.trim().is_empty() {
        return Err("Hotkey cannot be empty".to_string());
    }
    Ok(())
}

// ============================================================================
// Hotkey Tracking Logic
// ============================================================================

const MIN_PRESS_RELEASE_INTERVAL: Duration = Duration::from_millis(500);
const REACTIVATION_COOLDOWN: Duration = Duration::from_millis(200);

#[derive(Debug, Clone)]
pub(crate) enum HotkeyCommandResult {
    SendNow(RecordingCommand),
    SendStopAfter(Duration),
}

pub(crate) struct KeyStateTracker {
    active_hotkeys: HashSet<String>,
    last_press_at: Option<Instant>,
    pressed_keys: HashSet<String>,
    last_deactivated_at: std::collections::HashMap<String, Instant>,
}

impl KeyStateTracker {
    pub(crate) fn new() -> Self {
        Self {
            active_hotkeys: HashSet::new(),
            last_press_at: None,
            pressed_keys: HashSet::new(),
            last_deactivated_at: std::collections::HashMap::new(),
        }
    }

    pub(crate) fn update_key_state(&mut self, key: &str, is_press: bool) {
        if is_press {
            self.pressed_keys.insert(key.to_string());
        } else {
            self.pressed_keys.remove(key);
        }
    }

    fn matches_hotkey(&self, hotkey_config: &str, _trigger_key: &str) -> bool {
        let parts: Vec<String> = hotkey_config
            .split('+')
            .map(|s| normalize_key_string(s))
            .collect();
        if parts.is_empty() {
            return false;
        }
        parts.iter().all(|k| self.pressed_keys.contains(k))
    }

    pub(crate) fn process_event(
        &mut self,
        hotkey_config: &str,
        trigger_key: &str,
        is_press: bool,
        is_action: bool,
    ) -> Option<HotkeyCommandResult> {
        let hotkey_normalized = hotkey_config.trim().to_string();

        if is_press {
            if self.matches_hotkey(&hotkey_normalized, trigger_key) {
                if let Some(deactivated_at) = self.last_deactivated_at.get(&hotkey_normalized) {
                    if deactivated_at.elapsed() < REACTIVATION_COOLDOWN {
                        return None;
                    }
                }

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
            if self.active_hotkeys.contains(&hotkey_normalized) {
                let parts: Vec<String> = hotkey_normalized
                    .split('+')
                    .map(|s| normalize_key_string(s))
                    .collect();

                if parts.contains(&trigger_key.to_string()) {
                    self.active_hotkeys.remove(&hotkey_normalized);
                    self.last_deactivated_at
                        .insert(hotkey_normalized.clone(), Instant::now());

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

pub fn start_listener(
    app: AppHandle,
    recording_tx: mpsc::Sender<RecordingCommand>,
    config_rx: watch::Receiver<Vec<String>>,
    action_hotkey_rx: watch::Receiver<Vec<String>>,
    recording_state: Arc<Mutex<bool>>,
) {
    #[cfg(target_os = "macos")]
    {
        macos::start_listener(
            app,
            recording_tx,
            config_rx,
            action_hotkey_rx,
            recording_state,
        );
    }

    #[cfg(not(target_os = "macos"))]
    {
        eprintln!("Global key listener natively unsupported on this target via this module.");
    }
}
