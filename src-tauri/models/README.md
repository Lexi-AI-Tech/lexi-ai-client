# Whisper Models Directory

This directory contains the quantized Whisper model file bundled with the codebase.

## Model Information

- **Model**: `ggml-small-q5_1.bin`
- **Size**: ~181 MB
- **Type**: Quantized Whisper small multilingual model (q5_1 quantization)
- **Source**: [ggerganov/whisper.cpp on Hugging Face](https://huggingface.co/ggerganov/whisper.cpp)

The model is automatically bundled with the application via `tauri.conf.json` and is available at runtime.

## Model Details

- **small**: Multilingual model supporting 100+ languages
- **q5_1 quantization**: Reduces size to ~181 MB while maintaining good accuracy
- **Language**: Multilingual (supports 100+ languages including English, Spanish, French, German, etc.)

The `q5_1` quantization provides a good balance between size and accuracy.

## Language Support

This multilingual model supports automatic language detection. The code uses `--language auto` to detect the language automatically. You can also specify a language code (e.g., "en", "es", "fr", "de") if you know the language in advance.

## File Name

The code expects: `ggml-small-q5_1.bin`

If you need to use a different model, update the path in `src/whisper.rs`:
```rust
.join("models").join("ggml-small-q5_1.bin")
```

## Alternative Models

- **English-only**: `ggml-small.en-q5_1.bin` (~181 MB, better accuracy for English)
- **Base multilingual**: `ggml-base-q5_1.bin` (~142 MB, faster, less accurate)
- **Tiny multilingual**: `ggml-tiny-q5_1.bin` (~75 MB, fastest, least accurate)

---

# Model Distribution Strategies

Since the Whisper model file (`ggml-small-q5_1.bin`) is ~180MB and exceeds Git's recommended file size limits, here are several strategies to handle it:

## Strategy 1: Download During Build (✅ Currently Implemented)

**Best for**: Automated builds, CI/CD pipelines, GitHub Actions

### Implementation

1. **Model is in `.gitignore`**:
   ```gitignore
   src-tauri/models/*.bin
   !src-tauri/models/README.md
   ```

2. **Download script** (`scripts/download-model.sh`):
   - Automatically downloads the model if missing
   - Runs before build via `npm run prebuild`
   - Integrated into `tauri.conf.json` build process

3. **Usage**:
   ```bash
   # Manual download
   npm run download-model
   
   # Automatic (during build)
   npm run build
   ```

**Pros**: 
- ✅ No large files in Git
- ✅ Works in CI/CD
- ✅ Automatic for new developers

**Cons**: 
- Requires internet during build
- Slower first build

---

## Strategy 2: Download on First Run (Runtime Download)

**Best for**: Smaller initial app size, user-controlled downloads

### Implementation

1. **Add model download function to Rust** (`src/whisper.rs`):
   ```rust
   use std::fs;
   use std::path::PathBuf;
   use tauri::AppHandle;
   
   const MODEL_URL: &str = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small-q5_1.bin";
   const MODEL_NAME: &str = "ggml-small-q5_1.bin";
   
   async fn download_model_if_needed(app: &AppHandle) -> Result<PathBuf, String> {
       let model_path = get_model_path(app)?;
       
       if model_path.exists() {
           return Ok(model_path);
       }
       
       println!("📥 Model not found, downloading...");
       
       // Create models directory
       if let Some(parent) = model_path.parent() {
           fs::create_dir_all(parent)
               .map_err(|e| format!("Failed to create models directory: {}", e))?;
       }
       
       // Download model
       let response = reqwest::get(MODEL_URL).await
           .map_err(|e| format!("Failed to download model: {}", e))?;
       
       let bytes = response.bytes().await
           .map_err(|e| format!("Failed to read model data: {}", e))?;
       
       fs::write(&model_path, bytes)
           .map_err(|e| format!("Failed to save model: {}", e))?;
       
       println!("✅ Model downloaded successfully");
       Ok(model_path)
   }
   
   fn get_model_path(app: &AppHandle) -> Result<PathBuf, String> {
       // Use app data directory
       let app_data_dir = app.path()
           .app_data_dir()
           .map_err(|e| format!("Failed to get app data directory: {}", e))?;
       
       Ok(app_data_dir.join("models").join(MODEL_NAME))
   }
   ```

2. **Update `resolve_whisper_paths`** to check app data directory first:
   ```rust
   fn resolve_whisper_paths(app: &AppHandle) -> Result<(PathBuf, PathBuf), String> {
       // First check app data directory (for downloaded models)
       if let Ok(app_data_dir) = app.path().app_data_dir() {
           let model_path = app_data_dir.join("models").join("ggml-small-q5_1.bin");
           if model_path.exists() {
               // Use downloaded model
               // ... find whisper binary ...
               return Ok((whisper_bin, model_path));
           }
       }
       
       // Fall back to bundled resources
       // ... existing code ...
   }
   ```

3. **Add Tauri command to download model**:
   ```rust
   #[tauri::command]
   pub async fn download_whisper_model(app: AppHandle) -> Result<String, String> {
       download_model_if_needed(&app).await?;
       Ok("Model downloaded successfully".to_string())
   }
   ```

**Pros**: 
- Small initial app size
- User can choose when to download
- Works offline after first download

**Cons**: 
- Requires internet on first use
- More complex implementation
- Need to handle download progress/errors

---

## Strategy 3: Git LFS (Large File Storage)

**Best for**: Teams that need version control for the model

### Implementation

1. **Install Git LFS**:
   ```bash
   git lfs install
   ```

2. **Track model files**:
   ```bash
   git lfs track "src-tauri/models/*.bin"
   git add .gitattributes
   ```

3. **Add model to Git**:
   ```bash
   git add src-tauri/models/ggml-small-q5_1.bin
   git commit -m "Add Whisper model via Git LFS"
   ```

**Pros**: 
- Version control for model
- Works with existing Git workflow
- Automatic for team members

**Cons**: 
- Requires Git LFS setup
- GitHub LFS has bandwidth limits (1GB/month free)
- Larger repo size

---

## Strategy 4: External Hosting + Build Script

**Best for**: Public releases, CDN distribution

### Implementation

1. **Host model on CDN/object storage** (e.g., AWS S3, Cloudflare R2, GitHub Releases)

2. **Create download script**:
   ```bash
   #!/bin/bash
   MODEL_URL="https://your-cdn.com/models/ggml-small-q5_1.bin"
   MODEL_FILE="src-tauri/models/ggml-small-q5_1.bin"
   
   if [ ! -f "$MODEL_FILE" ]; then
       curl -L -o "$MODEL_FILE" "$MODEL_URL"
   fi
   ```

3. **Use in CI/CD or local builds**

**Pros**: 
- Fast downloads from CDN
- Can update model without new release
- No Git repo bloat

**Cons**: 
- Requires hosting setup
- Additional cost for bandwidth
- Dependency on external service

---

## Strategy 5: Bundle in Release Only

**Best for**: Simple setup, offline-first apps

### Implementation

1. **Add to `.gitignore`**:
   ```
   src-tauri/models/*.bin
   ```

2. **Keep model locally for development**

3. **Include in `tauri.conf.json` resources** (already done)

4. **Manual download for developers**:
   ```bash
   cd src-tauri/models
   curl -L -o ggml-small-q5_1.bin \
     "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small-q5_1.bin"
   ```

**Pros**: 
- Simple
- No extra dependencies
- Works offline

**Cons**: 
- Manual setup for new developers
- Model not in version control
- Each developer needs to download

---

## Recommended Approach: Hybrid (Strategy 1 + 2)

Combine build-time download for CI/CD with runtime download as fallback:

1. **Build script downloads model** (for CI/CD and releases)
2. **Runtime checks and downloads if missing** (for development)
3. **Model stored in app data directory** (user-writable location)

This gives you:
- ✅ Automatic setup in CI/CD
- ✅ Works for developers without manual steps
- ✅ Graceful fallback if build script fails
- ✅ No large files in Git

---

## Updating the Model

To update or replace the model manually:

```bash
cd src-tauri/models
curl -L -o ggml-small-q5_1.bin "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small-q5_1.bin"
```

Or use the download script:

```bash
npm run download-model
```
