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

## Updating the Model

If you need to update or replace the model:

```bash
cd src-tauri/models
curl -L -o ggml-small-q5_1.bin "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small-q5_1.bin"
```

## Alternative Models

- **English-only**: `ggml-small.en-q5_1.bin` (~181 MB, better accuracy for English)
- **Base multilingual**: `ggml-base-q5_1.bin` (~142 MB, faster, less accurate)
- **Tiny multilingual**: `ggml-tiny-q5_1.bin` (~75 MB, fastest, least accurate)

