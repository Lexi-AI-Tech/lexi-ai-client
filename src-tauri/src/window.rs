//! Window Management Module
//!
//! This module provides utilities for managing application windows, including
//! showing, focusing, and activating windows on macOS.

use tauri::{AppHandle, Manager};

/// Forces macOS app activation to bring windows to front.
///
/// Call this BEFORE window.show() or set_focus() on relaunches to ensure
/// the window appears above other applications.
#[cfg(target_os = "macos")]
fn activate_app_ignoring_others() {
    use cocoa::appkit::NSApp;
    use objc::*;
    unsafe {
        let ns_app = NSApp();
        #[allow(unexpected_cfgs)]
        let _: () = msg_send![ns_app, activateIgnoringOtherApps: cocoa::base::YES];
        println!("🍎 Activated app ignoring other apps (Cocoa call)");
    }
}

#[cfg(not(target_os = "macos"))]
fn activate_app_ignoring_others() {
    // No-op on other platforms
}

/// Unified helper to show and focus the main window with macOS activation.
///
/// This function:
/// 1. Activates the app (macOS only)
/// 2. Shows the main window
/// 3. Focuses the window with retries
/// 4. Temporarily sets always-on-top to ensure visibility (macOS only)
///
/// # Arguments
/// * `app` - The Tauri AppHandle
///
/// # Returns
/// * `true` - Successfully showed and focused the window
/// * `false` - Failed to show the window (window not found)
pub fn show_and_focus_main_window(app: &AppHandle) -> bool {
    println!("🔍 show_and_focus called from: reopen/delegate");
    if let Some(window) = app.get_webview_window("main") {
        #[cfg(target_os = "macos")]
        {
            // Force activation to bring window to front
            activate_app_ignoring_others();
        }

        if let Err(e) = window.show() {
            eprintln!("❌ Failed to show window: {}", e);
            return false;
        }
        println!("✅ Window shown");

        // Focus with retries
        let window_clone = window.clone();
        std::thread::spawn(move || {
            for attempt in 1..=3 {
                std::thread::sleep(std::time::Duration::from_millis(50 * attempt as u64));
                if window_clone.set_focus().is_ok() {
                    println!("✅ Window focused (attempt {})", attempt);
                    break;
                } else if attempt == 3 {
                    eprintln!("⚠️  Failed to focus after 3 attempts");
                }
            }

            // Temporary always-on-top to ensure it's visible (macOS)
            #[cfg(target_os = "macos")]
            {
                let _ = window_clone.set_always_on_top(true);
                let window_final = window_clone.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(200));
                    let _ = window_final.set_always_on_top(false);
                });
            }
        });
        true
    } else {
        eprintln!("❌ Main window not found");
        false
    }
}
