// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use tauri::{AppHandle, Manager};
use device_query::{DeviceQuery, DeviceState, Keycode};

mod audio_recorder;
mod speech_api;
mod text_injector;

use audio_recorder::AudioRecorder;
use speech_api::SpeechAPI;
use text_injector::TextInjector;



#[tauri::command]
async fn start_recording(_app_handle: AppHandle) -> Result<(), String> {
    // This command might be unused now that we use device_query, but keeping it for UI triggers if needed
    Ok(())
}

#[tauri::command]
async fn stop_recording() -> Result<(), String> {
    Ok(())
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
        .setup(move |app| {
            let app_handle = app.handle();
            let recording_state = recording.clone();

            let window = app.get_window("main").unwrap();
            
            // Position window at bottom center of screen, just above taskbar
            // if let Ok(monitor) = window.primary_monitor() {
            //     if let Some(monitor) = monitor {
            //         let screen_size = monitor.size();
            //         let window_size = window.inner_size().unwrap();
            //         let taskbar_height = 60.0; // Approximate taskbar/dock height
            //         let x = (screen_size.width as f64 / 2.0) - (window_size.width as f64 / 2.0);
            //         let y = screen_size.height as f64 - window_size.height as f64 - taskbar_height;
            //         window.set_position(tauri::LogicalPosition::new(x, y)).unwrap_or_default();
            //     }
            // }
            
            #[cfg(target_os = "macos")]
            {
                use cocoa::appkit::{NSWindow, NSWindowCollectionBehavior};
                use cocoa::base::id;
                use raw_window_handle::{HasRawWindowHandle, RawWindowHandle};

                if let RawWindowHandle::AppKit(handle) = window.raw_window_handle() {
                    let ns_window = handle.ns_window as id;
                    unsafe {
                        let mut behavior = ns_window.collectionBehavior();
                        behavior |= NSWindowCollectionBehavior::NSWindowCollectionBehaviorCanJoinAllSpaces;
                        ns_window.setCollectionBehavior_(behavior);
                    }
                }
            }
            
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
        .invoke_handler(tauri::generate_handler![start_recording, stop_recording])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}