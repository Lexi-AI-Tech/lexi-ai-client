# Lexi AI Client

A macOS desktop app for speech-to-text transcription with global hotkey support. Record your voice anywhere on your Mac and have it transcribed and inserted into any text field.

## Features

- 🎤 **Voice Recording**: Hold a configurable hotkey to record audio (default: Function key)
- 🤖 **AI Transcription**: Powered by Lexi AI Server (uses Groq's Whisper API internally)
- ⌨️ **Auto Text Injection**: Automatically types the transcription into your active text field
- 🌍 **Global Hotkey**: Works system-wide - configurable hotkey support (default: Function key)
- 🔐 **Google OAuth**: Secure authentication with Google OAuth 2.0 (PKCE)
- 🎯 **Pill Overlay**: Small transparent overlay window shows recording status
- ⚙️ **Configurable Hotkeys**: Change your hotkey anytime via the settings UI
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

### 3. Start Lexi AI Server

The client requires the Lexi AI Server to be running. The server handles:
- Speech-to-text transcription via Groq's Whisper API
- Google OAuth authentication
- User management and token storage

See the `lexi-ai-server` directory for server setup instructions.

**Default server URL**: `http://localhost:1230`

### 4. Grant Permissions

The app needs three macOS permissions:

1. **Microphone Access** - To record audio
   - System Settings → Privacy & Security → Microphone
2. **Input Monitoring** - To detect global hotkeys
   - System Settings → Privacy & Security → Input Monitoring
3. **Accessibility Access** - To inject text and retrieve cursor context
   - System Settings → Privacy & Security → Accessibility

**To grant permissions:**
1. Open **System Settings** → **Privacy & Security**
2. Click the **lock icon** and enter your password
3. Add your **Terminal** app (or the built Lexi AI app) to each required permission
4. Enable the checkbox for each permission

### 5. Run the App

```bash
npm run dev
```

The app will open and run in the background.

## How to Use

### Method 1: Global Hotkey (Recommended)

1. **Press and hold** your configured hotkey (default: **Function (Fn)** key)
2. **Speak** your message
3. **Release** the hotkey
4. The transcription will automatically be typed into your active text field
5. A pill overlay window will appear during recording to show status

### Method 2: UI Buttons

1. Open the Lexi AI app window
2. Click **"Start Recording"** button
3. Speak your message
4. Click **"Stop Recording"** button
5. The transcription will appear in the app and be automatically injected

### Changing Your Hotkey

1. Open the Lexi AI app window
2. Go to **Settings**
3. Click on the hotkey input field
4. Press your desired key combination
5. The hotkey will be saved automatically

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
│   ├── components/        # React components (settings, hotkey input, etc.)
│   └── index.css          # Styles
├── src-tauri/             # Backend (Rust + Tauri)
│   ├── src/
│   │   ├── main.rs              # Main app logic & Tauri commands
│   │   ├── audio_recorder.rs    # Audio recording (cpal)
│   │   ├── stt_service.rs       # Lexi AI Server API client
│   │   ├── text_injector.rs     # Text injection (clipboard + paste)
│   │   ├── global_key_listener.rs  # Global hotkey monitoring (rdev)
│   │   ├── permissions.rs       # macOS permission handling
│   │   ├── pill.rs              # Pill overlay window management
│   │   ├── cursor_context.rs    # Cursor context retrieval (macOS Accessibility)
│   │   ├── google_oauth.rs      # Google OAuth 2.0 with PKCE
│   │   └── config.rs            # Application configuration
│   ├── Cargo.toml         # Rust dependencies
│   └── tauri.conf.json    # Tauri configuration
└── package.json           # Node.js dependencies
```

## Troubleshooting

### "This app does not have Accessibility Permissions"

**Solution**: Grant Accessibility permissions (see step 4 above)

### Hotkey Not Working

**Possible causes:**
- Input Monitoring permission not granted
- Another app is using the same hotkey
- Try restarting the app after granting permissions
- Check that the hotkey is configured correctly in Settings

### Microphone Not Recording

**Solution**: 
1. Check System Settings → Privacy & Security → Microphone
2. Ensure the app (or Terminal) has microphone access
3. Make sure no other app is using the microphone
4. Check terminal output for error messages

### Transcription Fails or Returns 401 Error

**Possible causes:**
- Lexi AI Server is not running (should be at `http://localhost:1230`)
- Not logged in (authenticate via Google OAuth in the app)
- Server API key not configured (check server configuration)
- Check terminal output for detailed error messages

### Input Monitoring Permission Not Working

**Solution**:
1. System Settings → Privacy & Security → Input Monitoring
2. Add Terminal (for dev) or Lexi AI app (for production)
3. Restart the app completely after granting permission
4. On some macOS versions, you may need to restart your Mac

### Pill Window Not Appearing

**Solution**:
1. Check that the app has Accessibility permission
2. Try toggling the pill window via the UI
3. Check terminal output for window creation errors

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

### Modify the Default Hotkey

The default hotkey is set in `src-tauri/src/main.rs`:
```rust
let initial_config = HotkeyConfig {
    hotkey: "Fn".to_string(),
};
```

You can change this to any key or key combination (e.g., "Ctrl+Shift+P", "Cmd+K", "Option").
Note: Users can also change the hotkey via the Settings UI without modifying code.

## Tech Stack

- **Frontend**: React + TypeScript + Vite
- **Backend**: Rust + Tauri
- **Audio**: cpal (cross-platform audio library)
- **Hotkeys**: rdev (global keyboard event monitoring)
- **Text Injection**: arboard (clipboard) + AppleScript/enigo (keystroke simulation)
- **Speech-to-Text**: Lexi AI Server (uses Groq Whisper API internally)
- **Authentication**: Google OAuth 2.0 with PKCE
- **Accessibility**: macOS Accessibility API (AXUIElement) for cursor context

## License

MIT License - see LICENSE file for details.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
