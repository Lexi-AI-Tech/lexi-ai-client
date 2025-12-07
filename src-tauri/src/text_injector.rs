// TextInjector module handles injecting transcribed text into the currently active application
// It uses AppleScript on macOS to simulate keyboard input, specifically using the clipboard
// and Cmd+V paste command to insert text at the current cursor position

use std::process::Command;
use std::error::Error;

/// TextInjector provides functionality to inject text into the active application
/// 
/// This implementation uses AppleScript to:
/// 1. Copy the text to the system clipboard
/// 2. Simulate Cmd+V (paste) keystroke to insert the text
/// 
/// This approach works across all macOS applications and inserts text at the
/// current cursor position, making it ideal for voice-to-text workflows.
pub struct TextInjector;

impl TextInjector {
    /// Creates a new TextInjector instance
    pub fn new() -> Self {
        Self
    }

    /// Injects text into the currently active application
    /// 
    /// This method uses AppleScript to:
    /// 1. Copy the provided text to the system clipboard
    /// 2. Simulate a Cmd+V keystroke to paste the text
    /// 
    /// The text is inserted at the current cursor position in whatever application
    /// is currently active (text editor, browser, terminal, etc.).
    /// 
    /// # Arguments
    /// * `text` - The text to inject into the active application
    /// 
    /// # Returns
    /// * `Ok(())` - Successfully injected the text
    /// * `Err(Box<dyn Error>)` - An error if the AppleScript execution fails
    /// 
    /// # Note
    /// This method temporarily overwrites the clipboard contents. If you need to
    /// preserve the clipboard, you would need to save and restore it.
    pub fn inject_text(&self, text: &str) -> Result<(), Box<dyn Error + Send + Sync>> {
        // Escape double quotes in the text to prevent AppleScript syntax errors
        // This is important if the transcribed text contains quotes
        let escaped_text = text.replace("\"", "\\\"");
        
        // Build the AppleScript command
        // The script:
        // 1. Tells System Events (macOS automation framework)
        // 2. Sets the clipboard to our text
        // 3. Simulates Cmd+V keystroke (paste command)
        let script = format!(
            "tell application \"System Events\"\n\
             set the clipboard to \"{}\"\n\
             keystroke \"v\" using command down\n\
             end tell",
            escaped_text
        );

        // Execute the AppleScript using the osascript command-line tool
        // -e flag means "execute" the following script string
        let output = Command::new("osascript")
            .arg("-e")
            .arg(&script)
            .output()?;  // Capture both stdout and stderr

        // Check if the AppleScript execution was successful
        if !output.status.success() {
            // Extract error message from stderr
            let error_msg = String::from_utf8_lossy(&output.stderr);
            return Err(format!(
                "Failed to inject text: {}",
                error_msg
            ).into());
        }

        Ok(())
    }
}
