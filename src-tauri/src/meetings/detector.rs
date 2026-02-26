use active_win_pos_rs::get_active_window;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use tokio::time::sleep;

use crate::state::RoomState;

#[derive(Clone, serde::Serialize)]
pub struct MeetingContext {
    pub platform: String,
    pub title: String,
    pub confidence: f32,
}

pub fn start_meeting_detector(app_handle: AppHandle) {
    tauri::async_runtime::spawn(async move {
        // Debounce counter
        let mut consecutive_detects = 0;
        let mut in_cooldown_until = tokio::time::Instant::now();

        // 5 minute cooldown after a prompt is shown
        let cooldown_duration = Duration::from_secs(5 * 60);

        loop {
            // Poll every 1.5 seconds
            sleep(Duration::from_millis(1500)).await;

            // 1. Gatekeeper: If Lexi is actively recording or processing, skip detection
            let mut skip_detection = false;
            if let Some(room_state) = app_handle.try_state::<RoomState>() {
                if let Ok(is_recording) = room_state.is_recording.try_lock() {
                    if *is_recording {
                        skip_detection = true;
                    }
                }
            }
            
            if skip_detection {
                consecutive_detects = 0;
                sleep(Duration::from_secs(5)).await;
                continue;
            }

            // 2. Check cooldown
            if tokio::time::Instant::now() < in_cooldown_until {
                continue;
            }

            // 3. Active Window Heuristics (Title & App Name)
            if let Ok(win) = get_active_window() {
                let app = win.app_name.to_lowercase();
                let title = win.title.to_lowercase();

                let is_meeting = {
                    if app.contains("slack") {
                        title.contains("huddle") || title.contains("call") || title.contains("meeting")
                    } else if app.contains("zoom") {
                        title.contains("zoom meeting") || title.contains("meeting")
                    } else if app.contains("chrome") || app.contains("arc") || app.contains("safari") || app.contains("brave") {
                        title.contains("meet -") || title.contains("video call")
                    } else if app.contains("teams") {
                        title.contains("meeting") || title.contains("call")
                    } else {
                        false
                    }
                };

                if is_meeting {
                    consecutive_detects += 1;

                    // Require 2 consecutive detections (~3 seconds debounce) to avoid fluke tab switches
                    if consecutive_detects >= 2 {
                        let context = MeetingContext {
                            platform: app.clone(),
                            title: title.clone(),
                            confidence: 0.8, // Base confidence for window heuristic
                        };

                        println!(
                            "🎙️ Meeting detected! Platform: {}, Title: {}",
                            context.platform, context.title
                        );
                        // Emit event to frontend
                        let _ = app_handle.emit("meeting-detected", context);

                        // Enter cooldown to avoid spamming the user
                        in_cooldown_until = tokio::time::Instant::now() + cooldown_duration;
                        consecutive_detects = 0;
                    }
                } else {
                    consecutive_detects = 0;
                }
            } else {
                consecutive_detects = 0;
            }
        }
    });
}
