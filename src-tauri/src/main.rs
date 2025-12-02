// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::{Arc, Mutex, mpsc};
use std::thread;
use std::time::{Duration, SystemTime};
use std::fs;

use tauri::{AppHandle, Manager, State};
use device_query::{DeviceQuery, DeviceState, Keycode};
use chrono::{DateTime, Local};
use uuid::Uuid;

mod audio_recorder;
mod speech_api;
mod text_injector;
mod meeting_store;

use audio_recorder::AudioRecorder;
use speech_api::SpeechAPI;
use text_injector::TextInjector;
use meeting_store::{Meeting, MeetingStore};

struct MeetingState {
    stop_tx: Mutex<Option<mpsc::Sender<()>>>,
    audio_rx: Mutex<Option<mpsc::Receiver<Vec<u8>>>>,
    start_time: Mutex<Option<SystemTime>>,
}

#[tauri::command]
async fn start_recording(_app_handle: AppHandle) -> Result<(), String> {
    // This command might be unused now that we use device_query, but keeping it for UI triggers if needed
    Ok(())
}

#[tauri::command]
async fn stop_recording() -> Result<(), String> {
    Ok(())
}

#[tauri::command]
async fn start_meeting_recording(state: State<'_, MeetingState>, app_handle: AppHandle) -> Result<(), String> {
    let mut stop_tx_guard = state.stop_tx.lock().unwrap();
    if stop_tx_guard.is_some() {
        return Err("Recording already in progress".to_string());
    }

    let (stop_tx, stop_rx) = mpsc::channel();
    let (audio_tx, audio_rx) = mpsc::channel();

    thread::spawn(move || {
        let mut recorder = AudioRecorder::new();
        if let Err(e) = recorder.start_recording() {
            eprintln!("Failed to start recording: {}", e);
            return;
        }
        
        // Wait for stop signal
        let _ = stop_rx.recv();
        
        match recorder.stop_recording() {
            Ok(audio) => {
                let _ = audio_tx.send(audio);
            }
            Err(e) => eprintln!("Failed to stop recording: {}", e),
        }
    });

    *stop_tx_guard = Some(stop_tx);
    *state.audio_rx.lock().unwrap() = Some(audio_rx);
    *state.start_time.lock().unwrap() = Some(SystemTime::now());
    
    app_handle.emit_all("meeting_recording_started", ()).unwrap_or_default();
    Ok(())
}

#[tauri::command]
async fn stop_meeting_recording(
    state: State<'_, MeetingState>, 
    app_handle: AppHandle
) -> Result<Meeting, String> {
    let stop_tx = {
        let mut stop_tx_guard = state.stop_tx.lock().unwrap();
        stop_tx_guard.take().ok_or("No recording in progress")?
    };
    
    // Send stop signal
    stop_tx.send(()).map_err(|_| "Failed to stop recording thread")?;
    
    let audio_rx = {
        let mut audio_rx_guard = state.audio_rx.lock().unwrap();
        audio_rx_guard.take().ok_or("No audio receiver found")?
    };
    
    // Wait for audio data
    let audio_data = audio_rx.recv().map_err(|_| "Failed to receive audio data")?;
    
    let start_time = state.start_time.lock().unwrap().take().unwrap_or(SystemTime::now());
    let duration = start_time.elapsed().unwrap_or_default().as_secs();
    
    let api = SpeechAPI::new();
    let transcript = api.transcribe_audio(audio_data.clone()).await.map_err(|e| e.to_string())?;
    let summary = api.summarize_text(&transcript).await.map_err(|e| e.to_string())?;
    
    // Save to file
    let store = MeetingStore::new(&app_handle.config());
    let audio_dir = store.get_audio_dir();
    let audio_filename = format!("{}.wav", Uuid::new_v4());
    let audio_path = audio_dir.join(&audio_filename);
    
    fs::write(&audio_path, audio_data).map_err(|e| e.to_string())?;
    
    let meeting = Meeting {
        id: Uuid::new_v4().to_string(),
        title: format!("Meeting on {}", Local::now().format("%Y-%m-%d %H:%M")),
        date: Local::now().to_rfc3339(),
        duration_seconds: duration,
        audio_path: audio_path.to_string_lossy().to_string(),
        transcript,
        summary,
    };
    
    store.save_meeting(meeting.clone())?;
    
    app_handle.emit_all("meeting_processed", &meeting).unwrap_or_default();
    
    Ok(meeting)
}

#[tauri::command]
fn get_all_meetings(app_handle: AppHandle) -> Result<Vec<Meeting>, String> {
    let store = MeetingStore::new(&app_handle.config());
    Ok(store.get_meetings())
}

fn process_audio(audio_data: Vec<u8>, app_handle: AppHandle) {
    thread::spawn(move || {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            println!("Processing audio, size: {} bytes", audio_data.len());
            
            // Emit processing start event
            app_handle.emit_all("processing_start", ()).unwrap_or_default();
            
            let api = SpeechAPI::new();
            match api.transcribe_audio(audio_data).await {
                Ok(transcription) => {
                    println!("Transcription: {}", transcription);
                    
                    // Emit success event with transcription
                    app_handle.emit_all("transcription_success", &transcription).unwrap_or_default();
                    
                    if !transcription.trim().is_empty() {
                        let injector = TextInjector::new();
                        if let Err(e) = injector.inject_text(&transcription) {
                            eprintln!("Failed to inject text: {}", e);
                            app_handle.emit_all("injection_error", e.to_string()).unwrap_or_default();
                        } else {
                            app_handle.emit_all("injection_success", ()).unwrap_or_default();
                        }
                    }
                }
                Err(e) => {
                    eprintln!("Transcription failed: {}", e);
                    app_handle.emit_all("transcription_error", e.to_string()).unwrap_or_default();
                }
            }
        });
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn main() {
    let recording = Arc::new(Mutex::new(false));
    
    tauri::Builder::default()
        .manage(MeetingState {
            stop_tx: Mutex::new(None),
            audio_rx: Mutex::new(None),
            start_time: Mutex::new(None),
        })
        .setup(move |app| {
            let app_handle = app.handle();
            let recording_state = recording.clone();
            
            // Spawn the hotkey listener thread
            thread::spawn(move || {
                let mut recorder: Option<AudioRecorder> = None;
                
                let device_state = DeviceState::new();
                let mut was_pressed = false;

                loop {
                    let keys: Vec<Keycode> = device_state.get_keys();
                    
                    // Check for either Left Option or Right Option (macOS uses Option, not Alt)
                    let is_pressed = keys.contains(&Keycode::LOption) || keys.contains(&Keycode::ROption);

                    if is_pressed && !was_pressed {
                        // Key Pressed
                        let mut is_recording = recording_state.lock().unwrap();
                        if !*is_recording {
                            println!("Starting recording...");
                            *is_recording = true;
                            
                            // Notify frontend
                            app_handle.emit_all("recording_started", ()).unwrap_or_default();
                            
                            // Start recording
                            let mut new_recorder = AudioRecorder::new();
                            if let Err(e) = new_recorder.start_recording() {
                                eprintln!("Failed to start recording: {}", e);
                                *is_recording = false;
                                app_handle.emit_all("recording_error", e.to_string()).unwrap_or_default();
                            } else {
                                recorder = Some(new_recorder);
                            }
                        }
                    } else if !is_pressed && was_pressed {
                        // Key Released
                        let mut is_recording = recording_state.lock().unwrap();
                        if *is_recording {
                            println!("Stopping recording...");
                            *is_recording = false;
                            
                            // Notify frontend
                            app_handle.emit_all("recording_stopped", ()).unwrap_or_default();

                            if let Some(mut rec) = recorder.take() {
                                if let Ok(audio_data) = rec.stop_recording() {
                                    process_audio(audio_data, app_handle.clone());
                                }
                            }
                        }
                    }

                    was_pressed = is_pressed;
                    thread::sleep(Duration::from_millis(50));
                }
            });
            
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            start_recording, 
            stop_recording,
            start_meeting_recording,
            stop_meeting_recording,
            get_all_meetings
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}