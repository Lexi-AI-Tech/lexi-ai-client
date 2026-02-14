fn main() {
    if std::env::var("TARGET").map_or(false, |t| t.contains("darwin")) {
        println!("cargo:rustc-link-lib=framework=IOKit");   // IOHIDCheckAccess (Input Monitoring)
        println!("cargo:rustc-link-lib=framework=AVFoundation"); // AVCaptureDevice (Microphone)
    }
    tauri_build::build()
}
