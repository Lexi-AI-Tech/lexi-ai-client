use tauri::AppHandle;

#[tauri::command]
pub fn check_microphone_permission() -> Result<bool, String> {
    Ok(true)
}

#[tauri::command]
pub fn check_accessibility_permission(_app: AppHandle) -> Result<bool, String> {
    Ok(true)
}

#[tauri::command]
pub fn check_system_audio_permission(_app: AppHandle) -> Result<bool, String> {
    Ok(true)
}

#[tauri::command]
pub fn open_permission_pane(_pane: String) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
pub fn request_microphone_permission() -> Result<bool, String> {
    Ok(true)
}

#[tauri::command]
pub fn request_accessibility_permission(_app: AppHandle) -> Result<bool, String> {
    Ok(true)
}

#[tauri::command]
pub fn request_system_audio_permission(_app: AppHandle) -> Result<bool, String> {
    Ok(true)
}
