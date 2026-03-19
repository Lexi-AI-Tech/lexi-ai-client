//! macOS app icon retrieval for the Transcript List.
//!
//! Flow: Detect app name → NSWorkspace running applications → match by localizedName
//! → get NSRunningApplication::icon() → NSImage → TIFF → NSBitmapImageRep → PNG → Base64
//! → Tauri command returns data URL for React to render.

#[cfg(target_os = "macos")]
mod macos {
    use objc2::runtime::AnyObject;
    use objc2_app_kit::{
        NSBitmapImageFileType, NSBitmapImageRep, NSBitmapImageRepPropertyKey, NSImage,
        NSRunningApplication, NSWorkspace,
    };
    use objc2_foundation::{NSDictionary, NSString};

    /// Returns app icon as a data URL (e.g. "data:image/png;base64,...") for the given app name,
    /// or None if the app is not running or icon could not be produced.
    pub fn get_app_icon_data_url(app_name: &str) -> Option<String> {
        if app_name.is_empty() {
            return None;
        }
        let workspace = NSWorkspace::sharedWorkspace();
        let running = workspace.runningApplications();
        let count = running.count();
        let app_name_lower = app_name.to_lowercase();

        for i in 0..count {
            let app = running.objectAtIndex(i);
            let name = app.localizedName()?.to_string();
            // Match exact (case-insensitive) or when the stored name is contained in the app's localized name
            if name.eq_ignore_ascii_case(app_name)
                || name.to_lowercase().contains(app_name_lower.as_str())
            {
                if let Some(icon) = app.icon() {
                    if let Some(data_url) = nsimage_to_png_data_url(&icon) {
                        return Some(data_url);
                    }
                }
                break;
            }
        }

        // Fallback: try by bundle path if we have a name that might be a bundle id (e.g. "com.google.Chrome")
        if app_name.contains('.') {
            let ns_name = NSString::from_str(app_name);
            let apps = NSRunningApplication::runningApplicationsWithBundleIdentifier(&ns_name);
            if apps.count() > 0 {
                let app = apps.objectAtIndex(0);
                if let Some(icon) = app.icon() {
                    if let Some(data_url) = nsimage_to_png_data_url(&icon) {
                        return Some(data_url);
                    }
                }
            }
        }

        None
    }

    fn nsimage_to_png_data_url(image: &NSImage) -> Option<String> {
        let tiff_data = image.TIFFRepresentation()?;
        let bitmap_rep = NSBitmapImageRep::imageRepWithData(&tiff_data)?;

        // Empty dictionary for PNG representation options
        let empty = NSDictionary::<NSString, objc2_foundation::NSObject>::dictionary();
        let empty_ref: &NSDictionary<NSString, objc2_foundation::NSObject> = empty.as_ref();
        let props = unsafe { empty_ref.cast_unchecked::<NSBitmapImageRepPropertyKey, AnyObject>() };
        let png_data = unsafe {
            bitmap_rep.representationUsingType_properties(NSBitmapImageFileType::PNG, props)
        }?;

        let bytes = png_data.to_vec();
        let b64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &bytes);
        Some(format!("data:image/png;base64,{}", b64))
    }
}

/// Tauri command: get app icon as data URL for the given app name (macOS only).
/// Returns null on non-macOS or when the app is not found / icon cannot be produced.
#[tauri::command]
pub fn get_app_icon(app_name: String) -> Option<String> {
    #[cfg(target_os = "macos")]
    {
        macos::get_app_icon_data_url(app_name.trim())
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = app_name;
        None
    }
}
