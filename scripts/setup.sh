#!/bin/bash
# Complete setup script for Lexi AI Client
# Checks and sets up both Whisper model and binary

# Don't use set -e here - we want to handle errors gracefully
set +e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

BIN_DIR="src-tauri/bin"
MODEL_DIR="src-tauri/models"
BIN_FILE="$BIN_DIR/whisper"
MODEL_FILE="$MODEL_DIR/ggml-small-q5_1.bin"

# Detect platform
if [[ "$OSTYPE" == "darwin"* ]]; then
    PLATFORM="macos"
    BIN_NAME="whisper"
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    PLATFORM="linux"
    BIN_NAME="whisper"
elif [[ "$OSTYPE" == "msys" || "$OSTYPE" == "win32" ]]; then
    PLATFORM="windows"
    BIN_NAME="whisper.exe"
else
    PLATFORM="unknown"
    BIN_NAME="whisper"
fi

echo -e "${BLUE}🔧 Lexi AI Client Setup${NC}"
echo ""

# Check Whisper binary
echo -e "${BLUE}Checking Whisper binary...${NC}"
if [ -f "$BIN_FILE" ] || [ -f "$BIN_DIR/$BIN_NAME" ]; then
    BIN_PATH="$BIN_FILE"
    if [ ! -f "$BIN_PATH" ]; then
        BIN_PATH="$BIN_DIR/$BIN_NAME"
    fi
    
    # Check if executable
    if [ -x "$BIN_PATH" ]; then
        echo -e "${GREEN}✅ Whisper binary found: $BIN_PATH${NC}"
        
        # Try to verify it works
        if "$BIN_PATH" --help &>/dev/null; then
            echo -e "${GREEN}✅ Whisper binary is working${NC}"
        else
            echo -e "${YELLOW}⚠️  Whisper binary exists but may not be working correctly${NC}"
        fi
    else
        echo -e "${YELLOW}⚠️  Whisper binary found but not executable. Making it executable...${NC}"
        chmod +x "$BIN_PATH"
        echo -e "${GREEN}✅ Made executable${NC}"
    fi
else
    echo -e "${YELLOW}⚠️  Whisper binary not found: $BIN_DIR/$BIN_NAME${NC}"
    echo ""
    echo -e "${YELLOW}Note: Binaries are no longer bundled with the app${NC}"
    echo -e "${YELLOW}The app will look for the whisper executable in the user data directory:${NC}"
    echo ""
    echo "  macOS:   ~/Library/Application Support/com.lexi.ai/bin/whisper"
    echo "  Linux:   ~/.local/share/lexi-ai/bin/whisper"
    echo "  Windows: %APPDATA%\\lexi-ai\\bin\\whisper.exe"
    echo ""
    echo -e "${YELLOW}To build the Whisper binary:${NC}"
    echo ""
    echo "1. Install prerequisites:"
    echo "   macOS:  brew install cmake"
    echo "   Linux:  sudo apt-get install cmake build-essential"
    echo "   Windows: Install CMake and Visual Studio"
    echo ""
    echo "2. Clone and build whisper.cpp:"
    echo "   git clone https://github.com/ggerganov/whisper.cpp"
    echo "   cd whisper.cpp"
    echo "   make"
    echo ""
    echo "3. Copy the binary to the user data directory (see paths above)"
    echo ""
    echo -e "${YELLOW}⚠️  Continuing without binary - offline transcription will not work until binary is installed${NC}"
    BIN_MISSING=1
fi

echo ""

# Note: Models are no longer bundled with the app
# Users can download models through the Settings UI
echo -e "${BLUE}Note: Models are no longer bundled with the app${NC}"
echo -e "${YELLOW}📦 Models can be downloaded through the Settings page in the app${NC}"
echo -e "${YELLOW}   Models will be stored in the user data directory${NC}"

echo ""

# Set exit code based on what's missing
if [ -z "$BIN_MISSING" ]; then
    echo -e "${GREEN}✅ Setup complete! All dependencies are ready.${NC}"
    exit 0
else
    echo -e "${YELLOW}⚠️  Setup complete, but Whisper binary is missing.${NC}"
    echo -e "${YELLOW}   The app will not work until the binary is built.${NC}"
    # Don't fail - allow dev to continue, but warn
    exit 0
fi

