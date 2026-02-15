//! macOS-specific event consumers via CGEventTap (tauri-plugin-macos-input-monitor).

use tauri_plugin_macos_input_monitor::{Hotkey, MacOSInputMonitorExt, Modifiers};

/// Registers macOS event consumers (e.g. suppress emoji picker on Fn key when
/// "Press Fn to show Emoji & Symbols" is set in System Settings).
pub fn register(app: &tauri::App) {
    let hotkey = Hotkey {
        keycodes: vec![179], // Fn key (Globe key on some keyboards)
        modifiers: Modifiers::empty(),
        consume: true,
        event_name: "fn-key-consumed".to_string(),
    };
    let monitor = app.macos_input_monitor();
    let manager = monitor.manager.lock().unwrap();
    if let Ok(id) = manager.register(hotkey) {
        println!("🔇 Fn key (emoji picker) suppressed via macos-input-monitor: id {:?}", id);
    } else {
        eprintln!("⚠️  Failed to register Fn-key suppression hotkey");
    }
}
