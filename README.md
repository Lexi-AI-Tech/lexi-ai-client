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

3. **Download the Whisper model** (automatically done during build, or manually):
   ```bash
   npm run download-model
   ```
   
   Or manually:
   ```bash
   cd src-tauri/models
   curl -L -o ggml-small-q5_1.bin \
     "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small-q5_1.bin"
   ```

4. **Build the whisper binary** (if not already present):
   ```bash
   # See src-tauri/bin/README.md for instructions
   ```

## Development

```bash
npm run dev
```

This will:
- Download the model if missing (via `prebuild` script)
- Start the frontend dev server
- Launch the Tauri app

## Building

```bash
npm run build
```

This will:
- Download the model if missing
- Build the frontend
- Build the Tauri app with bundled resources

## Model Distribution

The Whisper model file (`ggml-small-q5_1.bin`, ~180MB) is not stored in Git due to size limitations. 

**For development**: The model is automatically downloaded during build via `scripts/download-model.sh`

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
