//! Application State Management Module
//!
//! This module defines all application state structures that are managed by Tauri.
//! These states are shared across the application and can be accessed via Tauri's state management.
//!
//! Only runtime state that needs to be in-memory (like task handles, recording state) is stored here.

use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};
use tokio::sync::{mpsc, watch};

/// State for watch sender (to broadcast config changes)
///
/// This state manages a watch channel that broadcasts hotkey configuration changes
/// to the global key listener thread. Uses Vec<String> directly from AppConfig.hotkeys.
pub struct HotkeyWatchState(pub watch::Sender<Vec<String>>);

/// State for watch sender (to broadcast action hotkey changes)
pub struct ActionHotkeyWatchState(pub watch::Sender<Vec<String>>);

/// When true, recording stop does not call transcription / action / doc processors (onboarding hotkey test).
pub struct OnboardingRecordingDryRun(pub Arc<AtomicBool>);

/// Hotkey recording state - tracks if we're in recording mode for hotkey selection
///
/// When in recording mode, the global key listener emits key events to the frontend
/// so users can interactively select their desired hotkey.
pub struct HotkeyRecordingState {
    /// Whether hotkey recording mode is currently active
    pub is_recording: Arc<Mutex<bool>>,
}

/// Meeting recording state
///
/// Note: AudioRecorder and MeetingWebSocket cannot be stored here because they contain
/// types that are not Send+Sync on macOS. They are managed in dedicated threads instead.
pub struct MeetingState {
    pub is_recording: Mutex<bool>,
    pub command_tx: Mutex<Option<std::sync::mpsc::Sender<()>>>,
    /// Signal to stop system audio capture (macOS; set by meeting audio module)
    pub system_stop_tx: Mutex<Option<std::sync::mpsc::Sender<()>>>,
    /// Sender to send an end event to the meeting WebSocket so the server can finalize and close the stream
    pub meeting_ws_text_tx: Mutex<Option<mpsc::Sender<String>>>,
    /// Signal to close the meeting WebSocket (send Close frame and exit send/recv tasks so connection and mic are released)
    pub meeting_ws_close_tx: Mutex<Option<mpsc::Sender<()>>>,
    /// Handle to the tray "Start Meeting" menu item for dynamic enable/disable
    pub tray_start_meeting: Mutex<Option<tauri::menu::MenuItem<tauri::Wry>>>,
    /// Broadcasts when meeting recording starts (true) or stops (false). Key listener uses this to disable assistant/action hotkeys.
    pub meeting_recording_tx: Mutex<watch::Sender<bool>>,
    /// Current meeting id while recording (used for reminders / UX)
    pub current_meeting_id: Mutex<Option<String>>,
    /// Background task handle for the 45-minute reminder loop (aborted on stop)
    pub reminder_task: Mutex<Option<tokio::task::JoinHandle<()>>>,
    /// Set when the mic watcher asks the user whether the external call has ended (cleared on dismiss or complete).
    pub pending_mic_ended_meeting_id: Mutex<Option<String>>,
}
