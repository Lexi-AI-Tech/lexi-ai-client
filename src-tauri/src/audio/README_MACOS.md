# Audio Module — Architecture & Developer Guide

This document describes the audio recording subsystem used for push-to-talk in the Lexi AI client. It is the knowledge base for anyone changing this module so we avoid regressions (especially on macOS) and keep behavior consistent.

---

## 1. Overview

The module provides:

- **Push-to-talk recording** driven by global hotkey (Start / Stop or ActionStart / ActionStop).
- **Two modes**: Assistant (speech-to-text) and Action (command/action mode).
- **Real-time volume** for UI (waveform / level).
- **Output**: 16-bit PCM WAV in memory for upstream APIs.

Capture uses **cpal** (Cross-Platform Audio Library); on macOS this goes through CoreAudio. A single **dedicated recording thread** owns the state machine and the `AudioRecorder`; the audio callback runs on a cpal/CoreAudio-managed thread.

---

## 2. Requirements

### Runtime / environment

- **Rust** (edition 2021). See repo root / `Cargo.toml` for exact toolchain.
- **cpal** `0.15` (used for `Stream::pause()` in teardown).
- **hound** for WAV encoding.

### macOS

- **Microphone permission**: The app must have **Microphone** access in **System Settings → Privacy & Security → Microphone**. Without it, device/open will fail.
- **Input device**: The code prefers a device whose name contains `"MacBook"` or `"Built-in"`, then falls back to the default input device.

### Other platforms

- The same code path runs on Windows/Linux; only macOS has the visible “orange mic” privacy indicator, but the teardown sequence is safe and recommended on all platforms.

---

## 3. Architecture

### 3.1 Components

| Component               | Location                                        | Role                                                                                                                                                                                   |
| ----------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Global key listener** | Outside this module                             | Sends `RecordingCommand` (Start / Stop / ActionStart / ActionStop) on an `mpsc` channel. Does not touch audio.                                                                         |
| **Recording thread**    | `thread.rs`                                     | Single `std::thread` that owns the state machine and the `AudioRecorder`. Only place that creates or drops the recorder. Receives commands, runs start/stop logic, emits Tauri events. |
| **AudioRecorder**       | `recorder.rs`                                   | Holds cpal `Device`, `StreamConfig`, optional `Stream`, shared buffer (`Arc<Mutex<Vec<f32>>>`), and `recording_active: Arc<AtomicBool>`. Builds and tears down the input stream.       |
| **Stream callback**     | `recorder.rs` (closure in `build_input_stream`) | Runs on cpal’s real-time thread. Reads `recording_active`, pushes samples into the buffer, optionally streams bytes and sends volume.                                                  |
| **Volume forwarder**    | `thread.rs` (spawned per session)               | Receives `f32` volume on a channel and emits `volume-update` to the frontend. Exits when the session’s sender is dropped (when the recorder that owned it is dropped).                 |
| **Tauri / frontend**    | Outside this module                             | Listens for `recording_started`, `recording_stopped`, `volume-update`, `recording_skipped`, `recording_error`, etc.                                                                    |

### 3.2 State machine (recording thread)

- **Idle** — No recorder. Accepts Start / ActionStart.
- **Starting** — Start received; tear down any previous recorder, wait, then create and start a new one. On success → Recording; on failure → Error, then transition to Idle.
- **Recording** — Stream active. Accepts Stop / ActionStop.
- **Stopping** — Stop received; call `stop_recording()`, then process audio (or skip if too short) and emit events. → Idle (or Error then Idle on failure).
- **Error** — Start or stop failed. We transition back to Idle so the next Start is accepted.

**Stuck detection**: If the phase stays **Starting** or **Stopping** longer than `STUCK_THRESHOLD` (8 s), the thread treats the session as stuck: it calls `release_stream()` on the current recorder (if any), clears context, emits `recording_error`, and goes to Idle.

### 3.3 Data flow (simplified)

1. Key press → command sent on channel.
2. Recording thread receives command; if Start (and Idle/Error): tear down existing recorder via `release_stream()`, sleep `CORE_AUDIO_RELEASE_DELAY` (50 ms), create new `AudioRecorder`, create volume channel, spawn volume forwarder, call `start_recording(None)`.
3. `start_recording`: set `recording_active = true`, build input stream (callback writes to buffer and sends volume), `stream.play()`, store stream.
4. On Stop: thread takes recorder, calls `stop_recording()` (teardown then WAV build), then emits events and may call `process_audio` / `process_action_audio`.
5. Volume forwarder runs until its sender is dropped (recorder dropped).

### 3.4 Teardown (macOS orange mic and correctness)

The kernel shows the orange mic while it considers the CoreAudio input session active. Simply dropping the cpal `Stream` can return before CoreAudio has fully closed the session, so the indicator can stick. Our teardown:

1. Set `recording_active = false` (callback stops doing work).
2. Sleep 30 ms (let callback and OS drain).
3. `stream.pause()` (cpal 0.15+).
4. Sleep 30 ms.
5. Drop the stream.
6. Sleep 20 ms (let OS release the session).

This sequence is implemented in:

- `AudioRecorder::stop_recording()` — at the start, before reading the buffer and building WAV.
- `AudioRecorder::release_stream()` — used when we are **not** going through `stop_recording()` (e.g. stuck recovery or replacing the recorder at Start).

The recording thread **always** tears down any existing recorder with `release_stream()` before creating a new one, and then sleeps `CORE_AUDIO_RELEASE_DELAY` (50 ms) before `AudioRecorder::new()` and `start_recording()`. Never drop an `AudioRecorder` or its `Stream` without going through this teardown.

---

## 4. Do’s and don’ts

### macOS and CoreAudio

- **Do** keep the teardown order: flag → sleep → pause → sleep → drop stream → sleep. Changing or shortening these steps can bring back the orange mic indicator.
- **Do** call `release_stream()` (or the same logic) whenever you would otherwise drop a recorder that still has an active stream (stuck recovery, replacing recorder at Start, or any new path that drops the recorder).
- **Do** wait at least `CORE_AUDIO_RELEASE_DELAY` (50 ms) after tearing down a session before opening a new one (`AudioRecorder::new()` / `start_recording()`).
- **Do** keep the callback’s first check as `if !recording_active.load(Ordering::Relaxed) { return; }` so it stops as soon as we signal teardown.
- **Don’t** drop the cpal `Stream` (or the `AudioRecorder` that owns it) without the full teardown sequence (“hot” drop).
- **Don’t** remove or significantly shorten the sleeps in `release_stream()` or `stop_recording()` on macOS; they are there so the OS can release the session.

### Threading and locking

- **Do** keep the recording thread as the **only** owner of `AudioRecorder` creation and destruction.
- **Do** keep the audio callback short: check flag, lock buffer briefly, push samples, optional volume/stream send. No heavy work or blocking calls inside the callback.
- **Don’t** block the recording thread on the async runtime or on long-running work; offload processing (e.g. `process_audio` / `process_action_audio`) to other threads or `spawn`.
- **Don’t** add new locks that can be held by the callback while the recording thread might wait on them; that can cause deadlock or stuck Stopping.

### State machine and commands

- **Do** handle both Assistant and Action commands (Start/ActionStart, Stop/ActionStop) in the same state machine and match phases correctly (e.g. Start only when Idle or Error).
- **Do** transition to Idle after a failed `start_recording` so the next Start can run (consistent with stop-failure behavior).
- **Don’t** create a new `AudioRecorder` or call `start_recording()` without first tearing down any existing recorder and waiting `CORE_AUDIO_RELEASE_DELAY`.

### Volume and UI

- **Do** spawn one volume-forwarder thread per recording session; it exits when the session’s sender is dropped.
- **Do** throttle volume updates in the callback (e.g. once per ~50 ms of audio) to avoid flooding the channel and the frontend.

### Format and dependencies

- **Do** keep WAV output as 16-bit PCM (hound) for compatibility with upstream APIs.
- **Do** keep using cpal 0.15+ if you rely on `stream.pause()` in teardown; if you change cpal version, check whether `pause()` exists and adjust teardown if needed.

---

## 5. Constants (thread.rs)

- `TIMEOUT_CHECK_INTERVAL` — 10 ms; how often the recording thread wakes to check for commands and stuck state.
- `STUCK_THRESHOLD` — 8 s; if Starting or Stopping lasts longer, we force teardown and Idle.
- `MIN_RECORDING_DURATION` — 500 ms; shorter recordings emit `recording_skipped` and are not sent for processing.
- `CORE_AUDIO_RELEASE_DELAY` — 50 ms; delay after `release_stream()` before opening a new session.

Changing these can affect responsiveness, robustness, and macOS mic indicator behavior; document and test any change.

---

## 6. Files in this module

- **`mod.rs`** — Module root; re-exports and high-level doc.
- **`recorder.rs`** — `AudioRecorder`, device/config, stream lifecycle, buffer, `recording_active`, `release_stream()`, `stop_recording()`, WAV build.
- **`thread.rs`** — Recording thread, state machine, command handling, volume forwarder spawn, calls into `recorder` and into `process_audio` / `process_action_audio`.
- **`meeting/`** (`mod.rs`, `macos.rs`, `win.rs`) — Meeting audio: mic + system audio (macOS tap + cpal, Windows WASAPI loopback). `start_meeting_audio`, `MeetingAudioHandles`, tagged `(source, chunk)` flow; see §8.

---

## 7. Making changes safely

- **Adding a new command or mode**: Update the state machine and command match in `thread.rs`; ensure Start/Stop semantics and phase transitions stay consistent; don’t skip teardown or the 50 ms delay before a new session.
- **Changing buffer or format**: Prefer not to hold the buffer lock longer in the callback; avoid blocking the recording thread when it needs the buffer after `stop_recording()`.
- **Switching to a ring buffer**: Possible for very long recordings; ensure the teardown sequence and `recording_active` are unchanged so macOS behavior remains correct.
- **Upgrading cpal**: Check that `Stream::pause()` (or equivalent) still exists and is used in `release_stream()` and `stop_recording()`; keep the same logical teardown order.

When in doubt, run through: start → record → stop → check orange mic clears on macOS; then start again and confirm no stuck indicator or overlapping sessions.

---

## 8. Meeting audio (`meeting/`)

Meeting recording provides **microphone + system audio** (system capture: macOS Core Audio tap + cpal; Windows WASAPI loopback) and sends each chunk with a **source tag** so the UI/backend can attribute transcripts to **user** (mic) or **system** (system audio). Shared orchestration lives in `meeting/mod.rs`; platform code is in `meeting/macos.rs` and `meeting/win.rs`. The mic uses `AudioRecorder` from `recorder.rs`.

### 8.1 Role

- **Inputs**: Mic via `AudioRecorder` (same as push-to-talk path); system audio on macOS via Core Audio **process tap** and an **aggregate device** feeding a cpal input stream.
- **Output**: Chunks sent as `(source, chunk)` where `source` is `"user"` or `"system"`. The meeting WebSocket/client sends these to the server so transcripts can be tagged by message type (e.g. user_audio / system_audio).

### 8.2 Components

| Item                      | Description                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`MeetingAudioHandles`** | Returned by `start_meeting_audio`. Holds `recorder_stop_tx` (signal to stop mic recording) and `system_stop_tx` (on macOS/Windows, signal to stop system audio capture). |
| **`send_tagged_chunks`**  | Internal: reads from an `mpsc::Receiver<Vec<u8>>`, tags each chunk with a fixed `source` (`"user"` or `"system"`), and sends `(source, chunk)` on the shared `output_tx` (tokio mpsc). Runs on a dedicated thread per source.                                                                                                                                                                                                                        |
| **`start_meeting_audio`** | Entry point in `meeting/mod.rs`. Creates mic channel and, on macOS/Windows, system-audio channel and stop channel. Spawns: (1) system audio capture thread (`meeting/macos.rs` or `meeting/win.rs`), (2) thread that runs `send_tagged_chunks` for mic, (3) thread that runs `send_tagged_chunks` for system, (4) thread that creates an `AudioRecorder`, calls `start_recording(Some(mic_tx))`, and blocks on `recorder_stop_rx` then calls `stop_recording()`. Returns `MeetingAudioHandles`. |

### 8.3 macOS system audio flow

1. **Default output device** — Get Core Audio default output device and its UID.
2. **Process tap** — Create a **global mono process tap** (excluding our process) via `TapDesc::with_mono_global_tap_excluding_processes` and `create_process_tap()`.
3. **Aggregate device** — Build an aggregate device that stacks the tap as a sub-device and uses the default output as main; name it `SYSTEM_AUDIO_TAP_NAME` (`"lexi-audio-tap"`). This makes the tap visible to cpal as an input device.
4. **Delay** — Sleep **300 ms** after creating the aggregate so Core Audio can register it and avoid a stale device list.
5. **cpal stream** — Open the host’s input devices, find the device named `lexi-audio-tap`, get its default input config, and build an input stream. The callback converts f32 samples to 16-bit PCM and sends them on `mpsc` to the `send_tagged_chunks` thread (source `"system"`).
6. **Teardown** — On `stop_rx` receive: set a `shutting_down` flag, call `stream.pause()`, drop the stream. The error callback checks `shutting_down` to avoid logging expected shutdown errors.

### 8.4 Threading

- **Mic**: One thread runs `AudioRecorder::start_recording(Some(mic_tx))` and blocks on `recorder_stop_rx`; when the stop signal is received it calls `stop_recording()`. Another thread runs `send_tagged_chunks(mic_rx, "user", ...)`.
- **System (macOS)**: One thread runs `macos::run_system_audio_capture` (tap + aggregate + cpal stream). Another runs `send_tagged_chunks(system_rx, "system", ...)`.
- **System (Windows)**: One thread runs `win::run_system_audio_capture` (WASAPI loopback). Another runs `send_tagged_chunks(system_rx, "system", ...)`.
- The same **teardown and delay rules** from the main README apply to the mic path (single `AudioRecorder` per meeting session, proper `stop_recording()` before dropping).

### 8.5 Constants (`meeting/macos.rs`)

- **`SYSTEM_AUDIO_TAP_NAME`** (macOS) — `"lexi-audio-tap"`; name of the aggregate device so cpal can find it as an input device.
- **Aggregate registration delay** — 300 ms after creating the aggregate device before enumerating cpal input devices.
