//! Application State Management Module
//!
//! This module defines all application state structures that are managed by Tauri.
//! These states are shared across the application and can be accessed via Tauri's state management.
//!
//! Only runtime state that needs to be in-memory (like task handles, recording state) is stored here.

use crate::global_key_listener::HotkeyConfig;
use std::sync::{Arc, Mutex};
use tokio::sync::watch;

/// Transcription task state for managing abort handles
///
/// This allows canceling ongoing transcriptions when a new one starts.
/// Each transcription task has a JoinHandle for cancellation and a oneshot channel
/// for canceling the underlying HTTP request.
pub struct TranscriptionTaskState {
    /// Handle to the current transcription task, if one is running
    pub task_handle: Mutex<Option<tauri::async_runtime::JoinHandle<()>>>,
    /// Sender for canceling the HTTP request associated with the transcription
    pub cancel_tx: Mutex<Option<tokio::sync::oneshot::Sender<()>>>,
}

/// State for watch sender (to broadcast config changes)
///
/// This state manages a watch channel that broadcasts hotkey configuration changes
/// to the global key listener thread.
pub struct HotkeyWatchState(pub watch::Sender<HotkeyConfig>);

/// Hotkey recording state - tracks if we're in recording mode for hotkey selection
///
/// When in recording mode, the global key listener emits key events to the frontend
/// so users can interactively select their desired hotkey.
pub struct HotkeyRecordingState {
    /// Whether hotkey recording mode is currently active
    pub is_recording: std::sync::Arc<Mutex<bool>>,
}

/// Recording channel state - stores the sender for recording commands
///
/// This allows the global shortcut handler to trigger recording
pub struct RecordingChannelState {
    /// Sender for recording commands (Start/Stop)
    pub tx: std::sync::Arc<Mutex<Option<std::sync::mpsc::Sender<crate::RecordingCommand>>>>,
    /// Current recording state (true if recording, false if idle)
    pub is_recording: Arc<Mutex<bool>>,
}
