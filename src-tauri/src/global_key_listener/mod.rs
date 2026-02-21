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
    UpArrow,
    DownArrow,
    LeftArrow,
    RightArrow,
    KeyA,
    KeyB,
    KeyC,
    KeyD,
    KeyE,
    KeyF,
    KeyG,
    KeyH,
    KeyI,
    KeyJ,
    KeyK,
    KeyL,
    KeyM,
    KeyN,
    KeyO,
    KeyP,
    KeyQ,
    KeyR,
    KeyS,
    KeyT,
    KeyU,
    KeyV,
    KeyW,
    KeyX,
    KeyY,
    KeyZ,
    Num1,
    Num2,
    Num3,
    Num4,
    Num5,
    Num6,
    Num7,
    Num8,
    Num9,
    Num0,
    Minus,
    Equal,
    LeftBracket,
    RightBracket,
    Backslash,
    Semicolon,
    Quote,
    Backquote,
    Comma,
    Period,
    Slash,
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
        Key::UpArrow => "Up".to_string(),
        Key::DownArrow => "Down".to_string(),
        Key::LeftArrow => "Left".to_string(),
        Key::RightArrow => "Right".to_string(),
        Key::KeyA => "A".to_string(),
        Key::KeyB => "B".to_string(),
        Key::KeyC => "C".to_string(),
        Key::KeyD => "D".to_string(),
        Key::KeyE => "E".to_string(),
        Key::KeyF => "F".to_string(),
        Key::KeyG => "G".to_string(),
        Key::KeyH => "H".to_string(),
        Key::KeyI => "I".to_string(),
        Key::KeyJ => "J".to_string(),
        Key::KeyK => "K".to_string(),
        Key::KeyL => "L".to_string(),
        Key::KeyM => "M".to_string(),
        Key::KeyN => "N".to_string(),
        Key::KeyO => "O".to_string(),
        Key::KeyP => "P".to_string(),
        Key::KeyQ => "Q".to_string(),
        Key::KeyR => "R".to_string(),
        Key::KeyS => "S".to_string(),
        Key::KeyT => "T".to_string(),
        Key::KeyU => "U".to_string(),
        Key::KeyV => "V".to_string(),
        Key::KeyW => "W".to_string(),
        Key::KeyX => "X".to_string(),
        Key::KeyY => "Y".to_string(),
        Key::KeyZ => "Z".to_string(),
        Key::Num1 => "1".to_string(),
        Key::Num2 => "2".to_string(),
        Key::Num3 => "3".to_string(),
        Key::Num4 => "4".to_string(),
        Key::Num5 => "5".to_string(),
        Key::Num6 => "6".to_string(),
        Key::Num7 => "7".to_string(),
        Key::Num8 => "8".to_string(),
        Key::Num9 => "9".to_string(),
        Key::Num0 => "0".to_string(),
        Key::Minus => "-".to_string(),
        Key::Equal => "=".to_string(),
        Key::LeftBracket => "[".to_string(),
        Key::RightBracket => "]".to_string(),
        Key::Backslash => "\\".to_string(),
        Key::Semicolon => ";".to_string(),
        Key::Quote => "'".to_string(),
        Key::Backquote => "`".to_string(),
        Key::Comma => ",".to_string(),
        Key::Period => ".".to_string(),
        Key::Slash => "/".to_string(),
        Key::Unknown(k) => format!("Keycode_{}", k), // Fallback
    }
}

/// Normalize config hotkey string for comparison
pub(crate) fn normalize_key_string(key: &str) -> String {
    let k = key.trim().to_lowercase();
    match k.as_str() {
        "cmd" | "command" | "meta" | "super" => "Command".to_string(),
        "ctrl" | "control" => "Control".to_string(),
        "option" | "alt" => "Option".to_string(),
        "shift" => "Shift".to_string(),
        "fn" => "Fn".to_string(),
        "esc" | "escape" => "Escape".to_string(),
        "return" | "enter" => "Enter".to_string(),
        "up" | "uparrow" => "Up".to_string(),
        "down" | "downarrow" => "Down".to_string(),
        "left" | "leftarrow" => "Left".to_string(),
        "right" | "rightarrow" => "Right".to_string(),
        _ => {
            if k.len() == 1 && k.chars().all(|c| c.is_alphabetic()) {
                k.to_uppercase()
            } else if k.starts_with("key") && k.len() > 3 {
                k[3..].to_string().to_uppercase()
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
