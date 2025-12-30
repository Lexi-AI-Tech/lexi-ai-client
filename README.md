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

3. **Run setup** (automatically done during dev/build, or manually):

   The setup script automatically checks and configures all dependencies when you run `npm run dev` or `npm run build`.
   It will:
   - ✅ Check for Whisper binary and provide instructions if missing
   - ✅ Download the Whisper model if missing (~181 MB)

   To run setup manually:

   ```bash
   npm run setup
   ```

   **Note**: The Whisper binary must be built manually (see `src-tauri/bin/README.md` for instructions).
   The setup script will warn you if it's missing but won't block development.

## Development

```bash
npm run dev
```

This will automatically:

- ✅ Check and setup Whisper binary (warns if missing)
- ✅ Download Whisper model if missing (via `predev` script)
- ✅ Start the frontend dev server
- ✅ Launch the Tauri app

## Building

```bash
npm run build
```

This will automatically:

- ✅ Check and setup Whisper binary (warns if missing)
- ✅ Download Whisper model if missing (via `prebuild` script)
- ✅ Build the frontend
- ✅ Build the Tauri app with bundled resources

## Model Distribution

The Whisper model file (`ggml-small-q5_1.bin`, ~180MB) is not stored in Git due to size limitations.

**For development**: Complete setup (model + binary check) runs automatically via `scripts/setup.sh` when running `npm run dev` or `npm run build`

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
└── scripts/               # Build scripts
    ├── setup.sh          # Complete setup script (model + binary check)
    └── download-model.sh  # Model download script
```

## Features

- 🎤 Local speech-to-text using Whisper.cpp
- ⌨️ Global hotkey support
- 📝 Automatic text injection
- 🔐 Google OAuth authentication
- 🎨 Modern React UI

## License

[Your License Here]
