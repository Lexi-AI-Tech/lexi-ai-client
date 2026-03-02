//! Application State Management Module
//!
//! This module defines all application state structures that are managed by Tauri.
//! These states are shared across the application and can be accessed via Tauri's state management.
//!
//! Only runtime state that needs to be in-memory (like task handles, recording state) is stored here.

use std::sync::{Arc, Mutex};
use tokio::sync::watch;

/// State for watch sender (to broadcast config changes)
///
/// This state manages a watch channel that broadcasts hotkey configuration changes
/// to the global key listener thread. Uses Vec<String> directly from AppConfig.hotkeys.
pub struct HotkeyWatchState(pub watch::Sender<Vec<String>>);

/// State for watch sender (to broadcast action hotkey changes)
pub struct ActionHotkeyWatchState(pub watch::Sender<Vec<String>>);

/// Hotkey recording state - tracks if we're in recording mode for hotkey selection
///
/// When in recording mode, the global key listener emits key events to the frontend
/// so users can interactively select their desired hotkey.
pub struct HotkeyRecordingState {
    /// Whether hotkey recording mode is currently active
    pub is_recording: Arc<Mutex<bool>>,
}

/// Room recording state
///
/// Note: AudioRecorder and RoomWebSocket cannot be stored here because they contain
/// types that are not Send+Sync on macOS. They are managed in dedicated threads instead.
pub struct RoomState {
    pub is_recording: Mutex<bool>,
    pub command_tx: Mutex<Option<std::sync::mpsc::Sender<()>>>,
}

/// Meeting recording state
///
/// Note: AudioRecorder and MeetingWebSocket cannot be stored here for the same reasons as RoomState.
pub struct MeetingState {
    pub is_recording: Mutex<bool>,
    pub command_tx: Mutex<Option<std::sync::mpsc::Sender<()>>>,
    /// Signal to stop system audio capture thread (macOS only)
    pub system_stop_tx: Mutex<Option<std::sync::mpsc::Sender<()>>>,
    /// Handle to the tray "Start Meeting" menu item for dynamic enable/disable
    pub tray_start_meeting: Mutex<Option<tauri::menu::MenuItem<tauri::Wry>>>,
}
