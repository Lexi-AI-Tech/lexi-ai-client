# Whisper Binary Directory

This directory should contain the compiled `whisper.cpp` binary.

## Prerequisites

- **CMake**: Required for building whisper.cpp
  ```bash
  brew install cmake  # macOS
  # or use your system's package manager
  ```

## Setup Instructions

1. Clone whisper.cpp:
   ```bash
   git clone https://github.com/ggerganov/whisper.cpp
   cd whisper.cpp
   ```

2. Build the binary:
   ```bash
   make
   ```
   This will create the binary in `build/bin/whisper-cli`

3. Copy the binary:
   ```bash
   cp build/bin/whisper-cli ../lexi-ai-client/src-tauri/bin/whisper
   ```

4. Make it executable (if needed):
   ```bash
   chmod +x ../lexi-ai-client/src-tauri/bin/whisper
   ```

5. Verify it works:
   ```bash
   cd ../lexi-ai-client/src-tauri/bin
   ./whisper --help
   ```

## Platform-Specific Notes

- **macOS**: 
  - The binary should be built for your target architecture (x86_64 or arm64)
  - For Apple Silicon (M1/M2/M3): The default build should work and produce an arm64 binary
  - For Intel Macs: May need to specify architecture or use Rosetta 2
  - The built binary will be `build/bin/whisper-cli` (Mach-O 64-bit executable)
  
- **Linux**: 
  - Build normally with `make`
  - Binary will be in `build/bin/whisper-cli`
  
- **Windows**: 
  - Build with appropriate toolchain (Visual Studio, MinGW, etc.)
  - Binary will be `build/bin/whisper-cli.exe`
  - Rename to `whisper.exe` when copying to this directory

## Important

- The binary will be bundled with the app and accessible via Tauri's resource resolver
- Make sure to build the binary for the target platform(s) you plan to distribute
- The correct binary to use is `whisper-cli` (not `main`), which is ~806KB for macOS arm64
- The model file (`ggml-small-q5_1.bin`) is already included in the `models/` directory and does not need to be downloaded separately

## Troubleshooting

- **"cmake: No such file or directory"**: Install CMake first (`brew install cmake` on macOS)
- **"main: No such file or directory"**: The binary is in `build/bin/whisper-cli`, not `main` in the root
- **Binary not found**: Make sure you've run `make` successfully and check `build/bin/` directory

