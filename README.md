# Lexi AI Client

Voice-first productivity overlay for macOS and Windows, built with [Tauri 2](https://tauri.app) (Rust) and React 18 + TypeScript.

- **Dictation**: hold a global hotkey, speak, and the transcript is typed into whatever app has focus.
- **Actions**: speak a command and the AI's output is injected at your cursor.
- **Meetings**: detect, record, and live-transcribe meetings.
- **Docs**: notes with voice input.
- **Pill overlay**: a small always-on-top indicator showing recording status.

The client talks to the separate `lexi-ai-server` backend for transcription, LLM calls, auth, and billing. This repo contains only the desktop app.

## Screenshots

<!-- Add images to docs/screenshots/ and reference them here, e.g.
![Dashboard](docs/screenshots/dashboard.png)
![Pill overlay](docs/screenshots/pill.png)
-->

_Screenshots coming soon._

## Table of Contents

- [Prerequisites](#prerequisites)
- [Getting Started](#getting-started)
- [Development](#development)
- [Building](#building)
- [Project Layout](#project-layout)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)
- [Security](#security)
- [License and Trademarks](#license-and-trademarks)

## Prerequisites

| Tool    | Version       | Notes                                                              |
| ------- | ------------- | ------------------------------------------------------------------ |
| Node.js | 18 or higher  | Includes `npm`                                                     |
| Rust    | latest stable | Install via [rustup](https://rustup.rs)                            |
| Tauri   | v2            | Installed with the project's dev dependencies (`@tauri-apps/cli`)  |

Platform-specific requirements (see the [Tauri prerequisites guide](https://tauri.app/start/prerequisites/)):

- **macOS**: Xcode Command Line Tools (`xcode-select --install`).
- **Windows**: Visual Studio 2022 (or Build Tools) with the "Desktop development with C++" workload, and the WebView2 runtime (preinstalled on Windows 11). Run commands from a **Visual Studio 2022 Developer Command Prompt** so native dependencies build correctly.

## Getting Started

```bash
git clone https://github.com/Lexi-AI-Tech/lexi-ai-client.git
cd lexi-ai-client
npm install
```

No `.env` is needed for normal development. `.env.sample` lists variables that only maintainers need for signed releases.

## Development

```bash
npm run dev
```

This starts Vite and the Tauri shell with hot reload.

Debug builds talk to a **local** `lexi-ai-server` at `http://localhost:3000` (see `src-tauri/src/config.rs`). Run the server locally, or temporarily edit `config.rs` to point at another instance.

Other useful commands:

```bash
npm run dev:frontend    # Vite only, without the Tauri shell
npm run build:frontend  # Frontend bundle only
npm run format          # cargo fmt + prettier
```

There is currently no automated test suite.

## Building

```bash
npm run build          # tauri build with the custom-protocol (production) feature
npm run build:mac      # scripts/build-mac.js
npm run build:windows  # scripts/build-windows.js
```

The `custom-protocol` feature switches the app from the local dev API to the production API and OAuth configuration. Installers are written to `src-tauri/target/release/bundle/`.

For a **notarized macOS DMG** to distribute, see [Building a distributable release](#building-a-distributable-release-notarized-dmg).

## Project Layout

| Path                | Contents                                                                                        |
| ------------------- | ----------------------------------------------------------------------------------------------- |
| `src/`              | React/TypeScript UI. Talks to Rust through `invoke()` and `listen()`.                           |
| `src-tauri/src/`    | Rust: audio capture, global hotkeys, text injection, windows, tray, keychain, meeting detection |
| `pill.html`         | Separate Vite entry for the recording pill overlay                                              |
| `scripts/`          | Build and release scripts                                                                       |
| `.github/workflows` | Release CI                                                                                      |

New server endpoints should be added as Rust `#[tauri::command]` wrappers (registered in `main.rs`) rather than called directly from React. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Troubleshooting

### Clearing App Configuration

To reset the app configuration (for example, to test with fresh defaults), delete the Tauri Store file.

#### Using Finder (macOS)

1. Open **Finder**
2. Click the **Go** menu in the menu bar
3. Hold the **Option** (⌥) key and select **Library**
4. Navigate to `Application Support/com.lexi.ai/`
5. Delete the file `.app-config.dat`

Alternatively, delete the entire `com.lexi.ai` folder to clear all app data.

#### Using Terminal

```bash
# Delete just the app config
rm ~/Library/Application\ Support/com.lexi.ai/.app-config.dat

# Or delete all app data
rm -rf ~/Library/Application\ Support/com.lexi.ai/
```

After deleting the config file, restart the app and it will fetch fresh configuration from the server.

### Run the Built App with Logs

```bash
"/Applications/Lexi AI.app/Contents/MacOS/lexi-ai"
```

All debug output appears in the terminal, which helps with issues in production builds.

### Building a distributable release (notarized DMG)

Without notarization and stapling, users installing from the DMG will see **"Lexi AI can't be opened"**. The DMG must contain the **stapled** app, so use the release script or CI. Do not distribute the raw DMG from `npm run build`.

From the project root, set your Apple Developer credentials and run the release script. It builds, notarizes, and staples the app, recreates the DMG, notarizes and staples the DMG, and copies the result into `release/` (gitignored).

```bash
export APPLE_ID="your-apple-id@example.com"
export APPLE_PASSWORD="your-app-specific-password"
export APPLE_TEAM_ID="YOUR_TEAM_ID"

./build-release.sh
```

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) and our [Code of Conduct](CODE_OF_CONDUCT.md) first.

## Security

Please do not report vulnerabilities in public issues. See [SECURITY.md](SECURITY.md).

## License and Trademarks

The code is released under the [MIT License](LICENSE). The Lexi name, logo, and other branding are not covered by that license; see [TRADEMARKS.md](TRADEMARKS.md). If you fork this project, please rename it and replace the logo and app icons.
