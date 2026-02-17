//! macOS Sleep/Wake Detection
//!
//! Registers for `NSWorkspaceDidWakeNotification` and `NSWorkspaceWillSleepNotification`
//! to detect when the system sleeps and wakes. On wake, spawns a fresh `rdev::listen`
//! thread after a delay, because macOS destroys the CGEventTap during deep sleep.
//!
//! Uses the Objective-C runtime (`objc` crate) to create a minimal observer class.

use crate::global_key_listener::start_listener;
use crate::RecordingCommand;
use std::sync::{Arc, Mutex};
use tokio::sync::watch;

/// Context passed to the ObjC observer callback via an instance variable.
struct WakeRestartContext {
    app: tauri::AppHandle,
    recording_tx: std::sync::mpsc::Sender<RecordingCommand>,
    config_rx: watch::Receiver<Vec<String>>,
    action_hotkey_rx: watch::Receiver<Vec<String>>,
    recording_state: Arc<Mutex<bool>>,
}

/// Registers a macOS observer for sleep/wake notifications.
///
/// When the system wakes from sleep, waits 3 seconds for macOS to restore
/// Input Monitoring, then spawns a fresh `rdev::listen` thread. The old dead
/// listener thread exits on its own when its `listen()` call returns.
///
/// Also logs sleep events for debugging.
pub fn start_sleep_watcher(
    app_handle: tauri::AppHandle,
    recording_tx: std::sync::mpsc::Sender<RecordingCommand>,
    config_rx: watch::Receiver<Vec<String>>,
    action_hotkey_rx: watch::Receiver<Vec<String>>,
    recording_state: Arc<Mutex<bool>>,
) {
    use objc::declare::ClassDecl;
    use objc::runtime::{Class, Object, Sel};
    use objc::{msg_send, sel, sel_impl};

    // Leak the context so the ObjC callback can read it for the app's lifetime
    let ctx = Box::new(WakeRestartContext {
        app: app_handle,
        recording_tx,
        config_rx,
        action_hotkey_rx,
        recording_state,
    });
    let ctx_ptr = Box::into_raw(ctx) as usize; // usize is Send

    std::thread::spawn(move || {
        let ctx_ptr = ctx_ptr as *mut std::ffi::c_void;
        unsafe {
            let superclass = Class::get("NSObject").unwrap();
            let mut decl = ClassDecl::new("LexiWakeObserver", superclass)
                .expect("Failed to create LexiWakeObserver class");

            decl.add_ivar::<*mut std::ffi::c_void>("_ctx");

            extern "C" fn handle_wake(this: &Object, _sel: Sel, _notif: *mut Object) {
                println!("☀️  System woke from sleep — restarting rdev listener in 3s...");
                unsafe {
                    let ptr: *mut std::ffi::c_void = *this.get_ivar("_ctx");
                    let ctx = &*(ptr as *const WakeRestartContext);

                    let app = ctx.app.clone();
                    let tx = ctx.recording_tx.clone();
                    let crx = ctx.config_rx.clone();
                    let arx = ctx.action_hotkey_rx.clone();
                    let rs = ctx.recording_state.clone();

                    // Spawn off the notification thread to avoid blocking it
                    std::thread::spawn(move || {
                        // Wait for macOS to fully restore Input Monitoring after wake
                        std::thread::sleep(std::time::Duration::from_secs(3));
                        println!("🔄 Spawning fresh rdev listener after wake...");
                        start_listener(app, tx, crx, arx, rs);
                    });
                }
            }

            extern "C" fn handle_sleep(_this: &Object, _sel: Sel, _notif: *mut Object) {
                println!("😴 System is going to sleep...");
            }

            decl.add_method(
                sel!(handleWake:),
                handle_wake as extern "C" fn(&Object, Sel, *mut Object),
            );
            decl.add_method(
                sel!(handleSleep:),
                handle_sleep as extern "C" fn(&Object, Sel, *mut Object),
            );

            let cls = decl.register();

            let observer: *mut Object = msg_send![cls, alloc];
            let observer: *mut Object = msg_send![observer, init];
            (*observer).set_ivar("_ctx", ctx_ptr);

            // NSWorkspace.sharedWorkspace.notificationCenter
            let workspace: *mut Object =
                msg_send![Class::get("NSWorkspace").unwrap(), sharedWorkspace];
            let center: *mut Object = msg_send![workspace, notificationCenter];

            // Register for wake notification
            let wake_name_cstr = std::ffi::CString::new("NSWorkspaceDidWakeNotification").unwrap();
            let wake_name: *mut Object = msg_send![
                Class::get("NSString").unwrap(),
                stringWithUTF8String: wake_name_cstr.as_ptr()
            ];
            let _: () = msg_send![center,
                addObserver: observer
                selector: sel!(handleWake:)
                name: wake_name
                object: std::ptr::null::<Object>()
            ];

            // Register for sleep notification (logging only)
            let sleep_name_cstr =
                std::ffi::CString::new("NSWorkspaceWillSleepNotification").unwrap();
            let sleep_name: *mut Object = msg_send![
                Class::get("NSString").unwrap(),
                stringWithUTF8String: sleep_name_cstr.as_ptr()
            ];
            let _: () = msg_send![center,
                addObserver: observer
                selector: sel!(handleSleep:)
                name: sleep_name
                object: std::ptr::null::<Object>()
            ];

            println!("😴 Sleep/wake watcher registered");

            // Run this thread's NSRunLoop to receive notifications
            let run_loop: *mut Object = msg_send![Class::get("NSRunLoop").unwrap(), currentRunLoop];
            let distant_future: *mut Object =
                msg_send![Class::get("NSDate").unwrap(), distantFuture];
            loop {
                let _: () = msg_send![run_loop, runUntilDate: distant_future];
                std::thread::sleep(std::time::Duration::from_secs(1));
            }
        }
    });
}
