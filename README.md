# Lexi AI Client

Speech-to-text overlay app for macOS built with Tauri and React.

## Setup

### Prerequisites

- Node.js (v18 or higher)
- Rust (latest stable)
- macOS (for development)

### Installation

1. **Clone the repository**:

   ```bash
   git clone <your-repo-url>
   cd lexi-ai-client
   ```

2. **Install dependencies**:

   ```bash
   npm install
   ```

**Note**: The Whisper binary must be built manually (see `src-tauri/bin/README.md` for instructions).

## Development

```bash
npm run dev
```

## Building

```bash
npm run build
```

## Model Distribution

The Whisper model file (`ggml-small-q5_1.bin`, ~180MB) is not stored in Git due to size limitations.

**For development**: Models should be placed in the user data directory manually.

**For production**: The model is bundled with the app via `tauri.conf.json` resources

See `src-tauri/models/MODEL_DISTRIBUTION_STRATEGIES.md` for detailed strategies on handling the model file.

## Project Structure

```
lexi-ai-client/
├── src/                    # React frontend
├── src-tauri/             # Rust backend
│   ├── src/               # Rust source code
│   ├── models/            # Whisper model (not in Git)
│   ├── bin/               # Whisper binary
│   └── tauri.conf.json    # Tauri configuration
└── public/                # Static assets
```

## Troubleshooting

### Clearing App Configuration

If you need to reset the app configuration (e.g., to test with fresh defaults), you can delete the Tauri Store file:

#### Using Finder (macOS)

1. Open **Finder**
2. Click on the **Go** menu in the menu bar
3. Press and hold the **Option** (⌥) key
4. Select **Library** (this option only appears when holding Option)
5. Navigate to: `Application Support/com.lexi.ai/`
6. Delete the file `.app-config.dat`

Alternatively, you can delete the entire `com.lexi.ai` folder to clear all app data.

#### Using Terminal

```bash
# Delete just the app config
rm ~/Library/Application\ Support/com.lexi.ai/.app-config.dat

# Or delete all app data
rm -rf ~/Library/Application\ Support/com.lexi.ai/
```

After deleting the config file, restart the app and it will fetch fresh configuration from the server with default values.

## Features

- 🎤 Local speech-to-text using Whisper.cpp
- ⌨️ Global hotkey support
- 📝 Automatic text injection
- 🔐 Google OAuth authentication
- 🎨 Modern React UI

## License

[Your License Here]
