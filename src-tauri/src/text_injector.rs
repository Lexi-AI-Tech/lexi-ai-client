//! Text Injector Module
//!
//! This module handles injecting transcribed text into the currently active application
//! at the current cursor position. It uses a clipboard + paste keystroke approach that
//! works across all applications and platforms.
//!
//! ## Implementation Strategy
//!
//! The injection method uses a two-step process:
//! 1. **Clipboard**: Copy the text to the system clipboard using `arboard`
//! 2. **Paste Keystroke**: Simulate the paste keyboard shortcut
//!    - macOS: Cmd+V (via AppleScript)
//!    - Windows/Linux: Ctrl+V (via `enigo`)
//!
//! This approach is more reliable than direct text injection because:
//! - Works in all applications (browsers, text editors, terminals, etc.)
//! - Respects application-specific paste behavior
//! - Doesn't require low-level window manipulation
//!
//! ## Dependencies
//!
//! - **arboard**: Cross-platform clipboard management (macOS, Windows, Linux/X11)
//! - **AppleScript** (macOS): Keyboard event simulation via `osascript`
//! - **enigo** (Windows/Linux): Cross-platform keyboard event simulation
//!
//! ## Permissions Required
//!
//! - **Accessibility** (macOS): Required for AppleScript keyboard simulation

use std::error::Error;
use std::process::Command;
use std::thread;
use std::time::Duration;
use arboard::Clipboard;

#[cfg(not(target_os = "macos"))]
use enigo::{Enigo, Key, Keyboard, Direction, Settings};

/// TextInjector provides cross-platform functionality to inject text into the active application
///
/// This implementation uses:
/// 1. `arboard` to set the system clipboard (cross-platform: macOS, Windows, Linux/X11)
/// 2. AppleScript on macOS to simulate the paste keystroke (Cmd+V)
/// 3. `enigo` on Windows/Linux to simulate the paste keystroke (Ctrl+V)
///
/// This approach works across all applications and inserts text at the
/// current cursor position, making it ideal for voice-to-text workflows.
///
/// # Permissions
/// - **macOS**: Requires **Accessibility** access for AppleScript keyboard simulation
/// - **Windows**: Usually works without extra permissions
/// - **Linux**: Needs X11 (enigo's Wayland support is experimental)
pub struct TextInjector;

impl TextInjector {
    /// Creates a new TextInjector instance
    pub fn new() -> Self {
        Self
    }

    /// Injects text into the currently active application
    ///
    /// This method:
    /// 1. Saves the current clipboard content (optional preservation)
    /// 2. Copies the provided text to the system clipboard
    /// 3. Simulates a paste keystroke (Cmd+V on macOS, Ctrl+V elsewhere)
    /// 4. Optionally restores the original clipboard content
    ///
    /// The text is inserted at the current cursor position in whatever application
    /// is currently active (text editor, browser, terminal, etc.).
    ///
    /// # Arguments
    /// * `text` - The text to inject into the active application
    ///
    /// # Returns
    /// * `Ok(())` - Successfully injected the text
    /// * `Err(Box<dyn Error>)` - An error if clipboard or key simulation fails
    ///
    /// # Note
    /// This method temporarily overwrites the clipboard contents. The original
    /// clipboard is not preserved by default for performance. If you need to
    /// preserve it, uncomment the clipboard save/restore code below.
    pub fn inject_text(&self, text: &str) -> Result<(), Box<dyn Error + Send + Sync>> {
        let mut clipboard = Clipboard::new()?;

        // Step 1: Set clipboard to the text we want to inject
        // arboard handles UTF-8 encoding and special characters automatically
        clipboard.set_text(text)?;

        // Small delay to ensure clipboard is ready
        thread::sleep(Duration::from_millis(50));

        // Step 2: Simulate paste keystroke
        // AppleScript on macOS, enigo on Windows/Linux
        #[cfg(target_os = "macos")]
        {
            self.paste_with_applescript()?;
        }
        #[cfg(not(target_os = "macos"))]
        {
            self.paste_with_enigo()?;
        }

        // Brief delay to ensure paste processes (some apps need a moment)
        thread::sleep(Duration::from_millis(50));

        Ok(())
    }

    /// Paste using AppleScript on macOS
    /// Simulates Cmd+V keystroke
    #[cfg(target_os = "macos")]
    fn paste_with_applescript(&self) -> Result<(), Box<dyn Error + Send + Sync>> {
        let applescript = r#"
            tell application "System Events"
                keystroke "v" using {command down}
            end tell
        "#;

        let output = Command::new("osascript")
            .arg("-e")
            .arg(applescript)
            .output()
            .map_err(|e| format!("Failed to run AppleScript: {}", e))?;

        if output.status.success() {
            Ok(())
        } else {
            let error = String::from_utf8_lossy(&output.stderr);
            Err(format!("AppleScript failed: {}", error).into())
        }
    }

    /// Paste using enigo on Windows/Linux
    /// Simulates Ctrl+V keystroke
    #[cfg(not(target_os = "macos"))]
    fn paste_with_enigo(&self) -> Result<(), Box<dyn Error + Send + Sync>> {
        let settings = Settings::default();
        let mut enigo = Enigo::new(&settings)
            .map_err(|e| format!("Failed to initialize enigo: {:?}", e))?;

        // Windows/Linux: Use Control key
        enigo
            .key(Key::Control, Direction::Press)
            .map_err(|e| format!("Failed to press Control key: {:?}", e))?;
        thread::sleep(Duration::from_millis(20));
        enigo
            .key(Key::Unicode('v'), Direction::Click)
            .map_err(|e| format!("Failed to click V key: {:?}", e))?;
        thread::sleep(Duration::from_millis(20));
        enigo
            .key(Key::Control, Direction::Release)
            .map_err(|e| format!("Failed to release Control key: {:?}", e))?;

        Ok(())
    }
}
