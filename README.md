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

Notarizing the APP
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