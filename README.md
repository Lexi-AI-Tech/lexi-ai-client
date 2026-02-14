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

For a **notarized DMG** to distribute (avoids "can't be opened" on install), use the release script: see [Building a distributable release](#building-a-distributable-release-notarized-dmg).

## Project Structure

```
lexi-ai-client/
├── src/                   # React frontend
├── src-tauri/             # Rust backend
│   ├── src/               # Rust source code
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

### Run the Built App with Logs

To run the built app from the command line and see logs:

```bash
"/Applications/Lexi AI.app/Contents/MacOS/lexi-ai"
```

This is useful for debugging issues in the production build, as all debug output will appear in the terminal.

### Building a distributable release (notarized DMG)

Without notarization and stapling, users installing from the DMG will see **"Lexi AI can't be opened"**. The DMG must contain the **stapled** app (not the one Tauri outputs), so use the release script or CI—do not distribute the raw DMG from `npm run build`.

**Option A: Local build (recommended script)**

**Build script:** `./build-release.sh` does the full flow (build → notarize & staple app → recreate DMG with stapled app → notarize & staple DMG) and writes the stapled DMG to `release/` (gitignored).

```bash
export APPLE_ID="saivallampati6@gmail.com"
export APPLE_PASSWORD="ylra-xsdw-debh-qavs"
export APPLE_TEAM_ID="FWLCJN85BF"
./build-release.sh
```

From the project root, set Apple credentials and run the release script. The script builds, notarizes and staples the app, recreates the DMG with that app, then notarizes and staples the DMG, and copies the final file into `release/` (gitignored).

```bash
export APPLE_ID="saivallampati6@gmail.com"
export APPLE_PASSWORD="ylra-xsdw-debh-qavs"
export APPLE_TEAM_ID="FWLCJN85BF"

npm run tauri build
```
or 
```bash
xcrun notarytool submit \
"/Users/ranjeetbaraik/Desktop/personal/lexi/lexi-ai-client/src-tauri/target/release/bundle/dmg/Lexi AI_0.1.0_aarch64.dmg" \
--apple-id "saivallampati6@gmail.com" \
--password "ylra-xsdw-debh-qavs" \
--team-id "FWLCJN85BF" \
--wait
```

Staple the app
```bash
xcrun stapler staple \
"/Users/ranjeetbaraik/Desktop/personal/lexi/lexi-ai-client/src-tauri/target/release/bundle/macos/Lexi AI.app"
```

Staple the dmg
```bash
xcrun stapler staple \
"/Users/ranjeetbaraik/Desktop/personal/lexi/lexi-ai-client/src-tauri/target/release/bundle/dmg/Lexi AI_0.1.0_aarch64.dmg"
```

Final Gatekeeper Test
```bash
spctl -a -vvv -t install \
"/Users/ranjeetbaraik/Desktop/personal/lexi/lexi-ai-client/src-tauri/target/release/bundle/dmg/Lexi AI_0.1.0_aarch64.dmg"
```

Staple Check
```bash
spctl -a -vvv -t install "/Users/ranjeetbaraik/Desktop/personal/lexi/lexi-ai-client/src-tauri/target/release/bundle/dmg/Lexi AI_0.1.0_aarch64.dmg"
```

Tauri Build
```bash
APPLE_ID="saivallampati6@gmail.com" APPLE_PASSWORD="ylra-xsdw-debh-qavs" APPLE_TEAM_ID="FWLCJN85BF" npm run tauri build
```