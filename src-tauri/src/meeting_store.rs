use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::api::path::app_data_dir;
use tauri::Config;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Meeting {
    pub id: String,
    pub title: String,
    pub date: String,
    pub duration_seconds: u64,
    pub audio_path: String,
    pub transcript: String,
    pub summary: String,
}

pub struct MeetingStore {
    file_path: PathBuf,
}

impl MeetingStore {
    pub fn new(app_config: &Config) -> Self {
        let mut path = app_data_dir(app_config).expect("failed to get app data dir");
        path.push("meetings.json");
        
        // Ensure directory exists
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap_or_default();
        }

        Self { file_path: path }
    }

    pub fn get_meetings(&self) -> Vec<Meeting> {
        if !self.file_path.exists() {
            return Vec::new();
        }

        let content = fs::read_to_string(&self.file_path).unwrap_or_default();
        serde_json::from_str(&content).unwrap_or_else(|_| Vec::new())
    }

    pub fn save_meeting(&self, meeting: Meeting) -> Result<(), String> {
        let mut meetings = self.get_meetings();
        meetings.push(meeting);
        
        let content = serde_json::to_string_pretty(&meetings)
            .map_err(|e| e.to_string())?;
            
        fs::write(&self.file_path, content)
            .map_err(|e| e.to_string())?;
            
        Ok(())
    }

    pub fn get_audio_dir(&self) -> PathBuf {
        let mut path = self.file_path.parent().expect("failed to get parent dir").to_path_buf();
        path.push("audio");
        fs::create_dir_all(&path).unwrap_or_default();
        path
    }
}
