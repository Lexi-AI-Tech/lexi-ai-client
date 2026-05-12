# Lexi AI Client

Speech-to-text overlay app for macOS and Windows built with Tauri and React.

## Table of Contents

- [Setup](#setup)
  - [Prerequisites](#prerequisites)
  - [Installation - macOS](#installation---macos)
  - [Installation - Windows](#installation---windows)
- [Development](#development)
- [Building](#building)
- [Troubleshooting](#troubleshooting)

## Setup

### Prerequisites

- Node.js (v18 or higher)
- Rust (latest stable)
- **Windows Only**: Visual Studio 2022 Developer Command Prompt (required for building native dependencies)

### Installation - macOS

1. **Clone the repository**:

   ```bash
   git clone <your-repo-url>
   cd lexi-ai-client
   ```

2. **Install dependencies**:

   ```bash
   npm install
   ```

### Installation - Windows

1. **Open Developer Command Prompt**: It is required to use the "Visual Studio 2022 Developer Command Prompt" to set up the project and ensure that native C/Rust dependencies build correctly.

   ```cmd
   cd %USERPROFILE%\Desktop\lexi\lexi-ai-client
   ```

2. **Clone the repository** (if not already done):

   ```cmd
   git clone <your-repo-url>
   ```

3. **Install dependencies**:

   ```cmd
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

For a **notarized DMG** to distribute (avoids "can't be opened" on install), use the release script: see [Building a distributable release](#building-a-distributable-release-notarized-dmg).

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

### Run the Built App with Logs

To run the built app from the command line and see logs:

```bash
"/Applications/Lexi AI.app/Contents/MacOS/lexi-ai"
```

This is useful for debugging issues in the production build, as all debug output will appear in the terminal.

### Building a distributable release (notarized DMG)

Without notarization and stapling, users installing from the DMG will see **"Lexi AI can't be opened"**. The DMG must contain the **stapled** app (not the one Tauri outputs), so use the release script or CI—do not distribute the raw DMG from `npm run build`.

**Local build (recommended script)**

From the project root, set your Apple Developer credentials as environment variables and run the release script. The script handles the full flow: builds, notarizes and staples the app, recreates the DMG with that app, then notarizes and staples the DMG, and finally copies the stapled DMG into the `release/` directory (gitignored).

```bash
export APPLE_ID="your-apple-id@example.com"
export APPLE_PASSWORD="your-app-specific-password"
export APPLE_TEAM_ID="YOUR_TEAM_ID"

./build-release.sh
```
