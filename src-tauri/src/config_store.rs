use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::AppHandle;
use tauri::Manager;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HotkeyConfig {
    pub key: String,
    pub modifiers: Vec<String>,
}

impl Default for HotkeyConfig {
    fn default() -> Self {
        Self {
            key: "Function".to_string(), // Default to Fn key
            modifiers: vec![],
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AppConfig {
    pub hotkey: HotkeyConfig,
}

pub struct ConfigStore {
    pub config: Mutex<AppConfig>,
    file_path: PathBuf,
}

impl ConfigStore {
    pub fn new(app_handle: &AppHandle) -> Self {
        let config_dir = app_handle.path().app_config_dir().unwrap_or_else(|_| {
            PathBuf::from("lexi-ai-config")
        });

        // Ensure directory exists
        if !config_dir.exists() {
            let _ = fs::create_dir_all(&config_dir);
        }

        let file_path = config_dir.join("config.json");
        
        let config = if file_path.exists() {
            match fs::read_to_string(&file_path) {
                Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
                Err(_) => AppConfig::default(),
            }
        } else {
            AppConfig::default()
        };

        Self {
            config: Mutex::new(config),
            file_path,
        }
    }

    pub fn save(&self) -> Result<(), String> {
        let config = self.config.lock().map_err(|e| e.to_string())?;
        let content = serde_json::to_string_pretty(&*config).map_err(|e| e.to_string())?;
        fs::write(&self.file_path, content).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn get_hotkey(&self) -> HotkeyConfig {
        self.config.lock().unwrap().hotkey.clone()
    }

    pub fn set_hotkey(&self, hotkey: HotkeyConfig) -> Result<(), String> {
        {
            let mut config = self.config.lock().map_err(|e| e.to_string())?;
            config.hotkey = hotkey;
        } // Release lock before saving
        self.save()
    }
}
