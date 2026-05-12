//! macOS: resolve app name via `NSWorkspace` / running apps → `NSImage` → PNG data URL.

use objc2::runtime::AnyObject;
use objc2_app_kit::{
    NSBitmapImageFileType, NSBitmapImageRep, NSBitmapImageRepPropertyKey, NSImage, NSRunningApplication,
    NSWorkspace,
};
use objc2_foundation::{NSDictionary, NSString};

/// Returns app icon as a data URL (e.g. `data:image/png;base64,...`) for the given app name,
/// or `None` if the app is not running or the icon could not be produced.
pub(super) fn get_app_icon_data_url(app_name: &str) -> Option<String> {
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
