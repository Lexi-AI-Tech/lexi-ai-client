# Lexi AI Client

A macOS overlay app built with Tauri that provides speech-to-text functionality with configurable hotkeys. The app can transcribe speech and inject the text into any input field on your Mac.

## Features

- 🎤 **Speech-to-Text**: Record audio and convert it to text using a backend API
- ⌨️ **Global Hotkey**: Configurable hotkey for triggering speech recording
- 🖥️ **Overlay Window**: Small, always-on-top overlay that doesn't interfere with other apps
- 📝 **Text Injection**: Automatically injects transcribed text into focused input fields
- ⚙️ **Configurable**: Set custom API endpoints and hotkeys

## Prerequisites

- macOS 10.15 or later
- Rust (latest stable version)
- Node.js 16 or later
- Xcode Command Line Tools

## Installation

### 1. Install Tauri CLI

```bash
npm install -g @tauri-apps/cli
```

### 2. Build the Tauri App

```bash
# Install Rust dependencies
cd src-tauri
cargo build

# Build the app
cd ..
npm run build
```

## Usage

### Run the App

```bash
npm run dev
```

### Using the App

1. **Start Recording**: Click "Start Recording" or use the default hotkey (Cmd+Shift+V)
2. **Speak**: Hold the hotkey and speak clearly
3. **Release**: Release the hotkey to stop recording and transcribe
4. **Text Injection**: The transcribed text ("hello world") will be automatically injected into the currently focused input field

## How It Works

The app now uses a simplified approach:
- Records audio for 2 seconds when the hotkey is pressed
- Returns "hello world" as the transcription (no external API needed)
- Injects the text into the currently focused input field

## Development

### Project Structure

```
lexi-ai-client/
├── src-tauri/          # Rust backend
│   ├── src/
│   │   ├── main.rs     # Main application logic
│   │   ├── audio_recorder.rs
│   │   ├── speech_api.rs
│   │   └── text_injector.rs
│   ├── Cargo.toml
│   └── tauri.conf.json
├── dist/               # Frontend
│   └── index.html
└── package.json
```

### Building for Production

```bash
npm run build
```

This will create a macOS app bundle in `src-tauri/target/release/bundle/macos/`.

## Permissions

The app requires the following macOS permissions:
- **Microphone Access**: To record audio for transcription
- **Accessibility**: To inject text into other applications

Grant these permissions when prompted or in System Preferences > Security & Privacy.

## Troubleshooting

### Audio Recording Issues
- Ensure microphone permissions are granted
- Check that no other app is using the microphone exclusively

### Text Injection Not Working
- Grant accessibility permissions in System Preferences
- Ensure the target application allows text input

## License

MIT License - see LICENSE file for details.
