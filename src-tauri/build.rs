fn main() {
    if std::env::var("TARGET").is_ok_and(|t| t.contains("darwin")) {
        println!("cargo:rustc-link-lib=framework=AVFoundation"); // AVCaptureDevice (Microphone)
    }
    tauri_build::build()
}
