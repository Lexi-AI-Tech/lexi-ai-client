# Lexi AI

A macOS desktop app for speech-to-text transcription with global hotkey support. Record your voice anywhere on your Mac and have it transcribed and inserted into any text field.

## Features

- 🎤 **Voice Recording**: Hold a hotkey to record audio
- 🤖 **AI Transcription**: Powered by Groq's Whisper API
- ⌨️ **Auto Text Injection**: Automatically types the transcription into your active text field
- 🌍 **Global Hotkey**: Works system-wide - press Option (⌥) key to record
- 🎯 **Lightweight**: Minimal UI, runs in the background

## Prerequisites

Before you begin, make sure you have:

- **macOS 10.15+** (Catalina or later)
- **Node.js 16+** - [Download here](https://nodejs.org/)
- **Rust** - Install with: `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`
- **Xcode Command Line Tools** - Install with: `xcode-select --install`

## Quick Start

### 1. Clone the Repository

```bash
git clone <your-repo-url>
cd lexi-ai-client
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Set Up API Key

1. Get a free API key from [Groq](https://console.groq.com/)
2. Copy the example environment file:
   ```bash
   cp src-tauri/.env.example src-tauri/.env
   ```
3. Edit `src-tauri/.env` and add your API key:
   ```
   GROQ_API_KEY=your_api_key_here
   ```

### 4. Grant Permissions

The app needs two macOS permissions:

1. **Microphone Access** - To record audio
2. **Accessibility Access** - To detect hotkeys and inject text

**To grant Accessibility permission:**
1. Open **System Settings** → **Privacy & Security** → **Accessibility**
2. Click the **lock icon** and enter your password
3. Add your **Terminal** app (or the built Lexi AI app)
4. Enable the checkbox

### 5. Run the App

```bash
npm run dev
```

The app will open and run in the background.

## How to Use

### Method 1: Global Hotkey (Recommended)

1. **Press and hold** the **Option (⌥)** key (either left or right)
2. **Speak** your message
3. **Release** the Option key
4. The transcription will automatically be typed into your active text field

### Method 2: UI Buttons

1. Click **"Start Recording"** in the app window
2. Speak your message
3. Click **"Stop Recording"**
4. The transcription will appear in the app

## Building for Production

To create a standalone macOS app:

```bash
npm run build
```

The app will be created at:
- **App Bundle**: `src-tauri/target/release/bundle/macos/Lexi AI.app`
- **DMG Installer**: `src-tauri/target/release/bundle/dmg/Lexi AI_0.1.0_aarch64.dmg`

You can then move the `.app` to your Applications folder or distribute the `.dmg`.

## Project Structure

```
lexi-ai-client/
├── src/                    # Frontend (React + TypeScript)
│   ├── App.tsx            # Main UI component
│   └── index.css          # Styles
├── src-tauri/             # Backend (Rust)
│   ├── src/
│   │   ├── main.rs        # Main app logic & hotkey listener
│   │   ├── audio_recorder.rs  # Audio recording
│   │   ├── speech_api.rs      # Groq API integration
│   │   └── text_injector.rs   # Text injection
│   ├── Cargo.toml         # Rust dependencies
│   └── .env               # API keys (not tracked in git)
└── package.json           # Node.js dependencies
```

## Troubleshooting

### "This app does not have Accessibility Permissions"

**Solution**: Grant Accessibility permissions (see step 4 above)

### Hotkey Not Working

**Possible causes:**
- Accessibility permissions not granted
- Another app is using the same hotkey
- Try restarting the app after granting permissions

### Microphone Not Recording

**Solution**: 
1. Check System Settings → Privacy & Security → Microphone
2. Ensure the app (or Terminal) has microphone access
3. Make sure no other app is using the microphone

### "GROQ_API_KEY not set" Error

**Solution**: 
1. Make sure you created `src-tauri/.env` (not just `.env.example`)
2. Add your API key: `GROQ_API_KEY=your_key_here`
3. Restart the app

### Same Transcription Every Time

**Possible causes:**
- API key not set correctly
- Audio not being recorded (check microphone permissions)
- Check terminal output for debug messages (🔍 DEBUG)

## Development

### Run in Development Mode

```bash
npm run dev
```

### View Logs

All debug output appears in the terminal where you ran `npm run dev`. Look for:
- `Starting recording...` - When recording starts
- `Stopping recording...` - When recording stops
- `🔍 DEBUG: Audio data size: XXX bytes` - Audio capture info
- `🔍 DEBUG: Full API response: {...}` - API response

### Modify the Hotkey

Edit `src-tauri/src/main.rs` and change:
```rust
let is_pressed = keys.contains(&Keycode::LOption) || keys.contains(&Keycode::ROption);
```

Available keycodes: `LControl`, `RControl`, `LShift`, `RShift`, `Command`, etc.

## Tech Stack

- **Frontend**: React + TypeScript + Vite
- **Backend**: Rust + Tauri
- **Audio**: cpal (cross-platform audio library)
- **Hotkeys**: device_query
- **API**: Groq Whisper (speech-to-text)

## License

MIT License - see LICENSE file for details.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
