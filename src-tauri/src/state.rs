//! Application State Management Module
//!
//! This module defines all application state structures that are managed by Tauri.
//! These states are shared across the application and can be accessed via Tauri's state management.

use std::sync::Mutex;
use tokio::sync::watch;
use crate::global_key_listener::HotkeyConfig;

/// Authentication token state for storing the current access token
/// 
/// This state is updated by the frontend whenever the authentication token changes.
/// The token is used for authenticated API requests to the Lexi AI Server.
#[derive(Default)]
pub struct AuthTokenState {
    /// The current authentication token, if available
    pub token: Mutex<Option<String>>,
}

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

