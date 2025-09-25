// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use std::sync::OnceLock;

use tauri::{AppHandle, GlobalShortcutManager, Manager, State};

mod audio_recorder;
mod speech_api;
mod text_injector;

use audio_recorder::AudioRecorder;
use speech_api::SpeechAPI;
use text_injector::TextInjector;

#[derive(Default)]
struct AppState {
    recording: Arc<Mutex<bool>>,
}

// Global state for hotkey handler
static GLOBAL_STATE: OnceLock<Arc<Mutex<bool>>> = OnceLock::new();

#[tauri::command]
async fn start_recording(
    state: State<'_, AppState>,
    _app_handle: AppHandle,
) -> Result<(), String> {
    let mut recording = state.recording.lock().unwrap();
    if *recording {
        return Ok(());
    }
    *recording = true;
    drop(recording);

    let recording_state = state.recording.clone();
    
    thread::spawn(move || {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let mut recorder = AudioRecorder::new();
            if let Err(e) = recorder.start_recording().await {
                eprintln!("Failed to start recording: {}", e);
                return;
            }

            // Record for a short duration
            thread::sleep(Duration::from_millis(2000));
            
            if let Ok(_audio_data) = recorder.stop_recording().await {
                let api = SpeechAPI::new("".to_string());
                match api.transcribe_audio(vec![]).await {
                    Ok(transcription) => {
                        if !transcription.trim().is_empty() {
                            let injector = TextInjector::new();
                            if let Err(e) = injector.inject_text(&transcription) {
                                eprintln!("Failed to inject text: {}", e);
                            }
                        }
                    }
                    Err(e) => eprintln!("Transcription failed: {}", e),
                }
            }

            let mut recording = recording_state.lock().unwrap();
            *recording = false;
        });
    });

    Ok(())
}

#[tauri::command]
async fn stop_recording(state: State<'_, AppState>) -> Result<(), String> {
    let mut recording = state.recording.lock().unwrap();
    *recording = false;
    Ok(())
}


#[tauri::command]
async fn is_recording(state: State<'_, AppState>) -> Result<bool, String> {
    let recording = state.recording.lock().unwrap();
    Ok(*recording)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn main() {
    tauri::Builder::default()
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            start_recording,
            stop_recording,
            is_recording
        ])
        .setup(|app| {
            let state = app.state::<AppState>();
            let recording_state = state.recording.clone();
            
            // Store global state for hotkey handler
            GLOBAL_STATE.set(recording_state.clone()).unwrap();
            
            // Register global hotkey (Cmd+Shift+V)
            if let Err(e) = app.global_shortcut_manager().register("CmdOrCtrl+Shift+V", || {
                if let Some(global_state) = GLOBAL_STATE.get() {
                    let recording = global_state.lock().unwrap();
                    if !*recording {
                        // Start recording in a separate thread
                        let state = global_state.clone();
                        thread::spawn(move || {
                            let rt = tokio::runtime::Runtime::new().unwrap();
                            rt.block_on(async {
                                let mut recording = state.lock().unwrap();
                                if *recording {
                                    return;
                                }
                                *recording = true;
                                drop(recording);

                                let recording_state = state.clone();
                                
                                thread::spawn(move || {
                                    let rt = tokio::runtime::Runtime::new().unwrap();
                                    rt.block_on(async {
                                        let mut recorder = AudioRecorder::new();
                                        if let Err(e) = recorder.start_recording().await {
                                            eprintln!("Failed to start recording: {}", e);
                                            return;
                                        }

                                        // Record for a short duration
                                        thread::sleep(Duration::from_millis(2000));
                                        
                                        if let Ok(_audio_data) = recorder.stop_recording().await {
                                            let api = SpeechAPI::new("".to_string());
                                            match api.transcribe_audio(vec![]).await {
                                                Ok(transcription) => {
                                                    if !transcription.trim().is_empty() {
                                                        let injector = TextInjector::new();
                                                        if let Err(e) = injector.inject_text(&transcription) {
                                                            eprintln!("Failed to inject text: {}", e);
                                                        }
                                                    }
                                                }
                                                Err(e) => eprintln!("Transcription failed: {}", e),
                                            }
                                        }

                                        let mut recording = recording_state.lock().unwrap();
                                        *recording = false;
                                    });
                                });
                            });
                        });
                    }
                }
            }) {
                eprintln!("Failed to register global shortcut: {}", e);
            }
            
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}