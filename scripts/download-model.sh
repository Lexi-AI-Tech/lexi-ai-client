#!/bin/bash
# Download Whisper model if it doesn't exist
# This script is used during build to ensure the model is available

set -e

MODEL_DIR="src-tauri/models"
MODEL_FILE="$MODEL_DIR/ggml-small-q5_1.bin"
MODEL_URL="https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small-q5_1.bin"

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

if [ -f "$MODEL_FILE" ]; then
    echo -e "${GREEN}✅ Model already exists: $MODEL_FILE${NC}"
    exit 0
fi

echo -e "${YELLOW}📥 Downloading Whisper model (~180MB)...${NC}"
echo "   URL: $MODEL_URL"
echo "   Destination: $MODEL_FILE"

# Create models directory if it doesn't exist
mkdir -p "$MODEL_DIR"

# Download the model
if command -v curl &> /dev/null; then
    curl -L --progress-bar -o "$MODEL_FILE" "$MODEL_URL"
elif command -v wget &> /dev/null; then
    wget --progress=bar -O "$MODEL_FILE" "$MODEL_URL"
else
    echo "❌ Error: Neither curl nor wget is installed"
    exit 1
fi

# Verify the file was downloaded
if [ -f "$MODEL_FILE" ]; then
    FILE_SIZE=$(du -h "$MODEL_FILE" | cut -f1)
    echo -e "${GREEN}✅ Model downloaded successfully (${FILE_SIZE})${NC}"
else
    echo "❌ Error: Model download failed"
    exit 1
fi

