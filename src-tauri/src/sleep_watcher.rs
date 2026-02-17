//! macOS Sleep/Wake Detection
//!
//! Registers for `NSWorkspaceDidWakeNotification` and `NSWorkspaceWillSleepNotification`
//! to detect when the system sleeps and wakes. On wake, calls `app_handle.restart()` to
//! fully relaunch the app — this revives the rdev CGEventTap AND refreshes all HTTP
//! connections, audio handles, and other OS resources that macOS invalidates during sleep.
//!
//! Uses the Objective-C runtime (`objc` crate) to create a minimal observer class.

/// Registers a macOS observer for sleep/wake notifications.
///
/// When the system wakes from sleep, waits 2 seconds for macOS to fully restore services,
/// then calls `app_handle.restart()` to relaunch the app with fresh state.
pub fn start_sleep_watcher(app_handle: tauri::AppHandle) {
    use objc::declare::ClassDecl;
    use objc::runtime::{Class, Object, Sel};
    use objc::{msg_send, sel, sel_impl};

    // Leak the AppHandle so the ObjC callback can use it for the app's lifetime.
    // Cast to usize to cross thread boundary (usize is Send, raw pointers are not).
    let handle_ptr = Box::into_raw(Box::new(app_handle)) as usize;

    std::thread::spawn(move || {
        let handle_ptr = handle_ptr as *mut std::ffi::c_void;
        unsafe {
            let superclass = Class::get("NSObject").unwrap();
            let mut decl = ClassDecl::new("LexiWakeObserver", superclass)
                .expect("Failed to create LexiWakeObserver class");

            decl.add_ivar::<*mut std::ffi::c_void>("_appHandle");

            extern "C" fn handle_wake(this: &Object, _sel: Sel, _notif: *mut Object) {
                println!("☀️  System woke from sleep — restarting app in 2s...");
                unsafe {
                    let ptr: *mut std::ffi::c_void = *this.get_ivar("_appHandle");
                    let app_handle = &*(ptr as *const tauri::AppHandle);

                    // Clone handle for the restart thread
                    let handle = app_handle.clone();
                    std::thread::spawn(move || {
                        // Wait for macOS to fully restore services after wake
                        std::thread::sleep(std::time::Duration::from_secs(2));
                        println!("🔄 Restarting app to revive all OS resources...");
                        handle.restart();
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
            (*observer).set_ivar("_appHandle", handle_ptr);

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
