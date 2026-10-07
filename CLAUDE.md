# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Lexi AI Client** — a Tauri 2 (Rust) + React 18/TypeScript desktop app for macOS and Windows. Global-hotkey voice dictation, AI "actions" (voice command → AI output injected at cursor), meeting recording/transcription, docs/notes with voice input, and a small always-on-top "pill" overlay showing recording status. Talks to the separate `lexi-ai-server` FastAPI backend (`server.speaklexi.com` in prod) for transcription, LLM calls, auth, and billing — this repo has no backend logic of its own beyond thin Rust command wrappers around that API.

## Commands

```bash
npm install                    # install JS deps
npm run dev                    # tauri dev (frontend + Rust backend, hot reload)
npm run dev:frontend           # vite only, no Tauri shell (rarely useful alone)

npm run build                  # tauri build -- --features custom-protocol (prod API/OAuth config)
npm run build:mac              # node scripts/build-mac.js
npm run build:windows          # node scripts/build-windows.js
npm run build:frontend         # vite build only

npm run format                 # cargo fmt (in src-tauri) + prettier --write . (repo root)
```

No test suite exists in this repo (no `test`/`lint` script in `package.json`).

**The `custom-protocol` feature flag is what switches prod vs dev config** — see `src-tauri/src/config.rs`: without it, `api_base_url()` returns `http://localhost:3000` and dev Google OAuth client id; with it (release builds / `npm run build`), it returns `https://server.speaklexi.com` and the prod OAuth client id. `npm run dev` does **not** pass this feature, so `tauri dev` always talks to a local `lexi-ai-server` on port 3000 — run that server locally, or edit `config.rs` temporarily to point at a remote one.

### Distributable (notarized) macOS build

`tauri build` alone is not distributable — macOS shows "can't be opened" without notarization+stapling. Use `./build-release.sh` (needs `APPLE_ID`, `APPLE_PASSWORD` app-specific password, `APPLE_TEAM_ID` env vars) or CI (`.github/workflows/release-production.yml`), which notarizes+staples both the `.app` and the `.dmg` and drops the result in `release/` (gitignored). Never distribute the raw `dist`/`target` DMG.

CI: `release-production.yml` under `.github/workflows/` handles signed builds. The certificate export and secrets setup guide lives in the separate `lexi-ai-documentation` repo (`docs/client/apple-signing-setup.md`).

### Resetting local app state

Tauri Store file at `~/Library/Application Support/com.lexi.ai/.app-config.dat` (macOS) holds app config; delete it to force a fresh config fetch from the server. Auth tokens live separately in secure storage (see below).

## Architecture

### Two-language split

- **`src/`** — React/TypeScript UI. Talks to Rust exclusively via `@tauri-apps/api/core`'s `invoke()` calling `#[tauri::command]` functions, and via `@tauri-apps/api/event`'s `listen()` for events Rust emits (tray actions, meeting lifecycle, update checks — see `src/App.tsx` for the canonical listener-setup pattern: dynamic-imported `listen`, cancellation flag, cleanup function returned from an async setup fn).
- **`src-tauri/src/`** — Rust. Owns everything OS-level: audio capture/recording, global hotkeys, text injection, window/pill management, OS keychain, meeting detection, system tray. `main.rs`'s module-doc header is the best single overview of what the Rust side does — read it first when touching Rust code.

Almost all HTTP calls to `lexi-ai-server` happen from **Rust**, not the frontend — commands under `src-tauri/src/commands/*.rs` (and feature-specific `src-tauri/src/<feature>/commands.rs` e.g. `actions/`, `assistant/`, `docs/`, `meetings/`) build the request, attach the bearer token via `get_auth_token_async`, and return a typed `Result<T, String>` to the frontend. **When adding a new server endpoint, add a matching Rust struct + `#[tauri::command]` here, not a raw `fetch`/`invoke` from React** — this keeps auth/error handling centralized. New commands must also be registered in `main.rs`'s `tauri::generate_handler![...]` list (`invoke_handler`) and imported near the top of `main.rs`, or the frontend's `invoke()` call will fail silently at runtime with no compile-time check.

**Gotcha**: Rust structs deserializing server JSON responses (`serde`) silently **drop unknown fields** and error on **missing** ones — if the server DTO gains a new field, the Rust struct in `commands/*.rs` needs the matching field added or it's just discarded (not a compile error, not a runtime error, just silently absent in the frontend).

### Recording pipeline (core feature)

A single `mpsc::Sender<RecordingCommand>` (`RecordingCommand` enum in `main.rs`) is the shared control channel between the global hotkey listener (`global_key_listener/`), the recording thread (`audio/thread.rs`, `spawn_recording_thread`), and UI-triggered recording (e.g. the Docs mic button). Variants distinguish dictation vs Action vs Doc recording (`Start`/`Stop`, `ActionStart`/`ActionStop`, `DocStart`/`DocStop`) and mode switches mid-recording (`SwitchToAction`/`SwitchToAssistant`). Audio → `audio/pipeline.rs` → sent to the server for STT → `text_injector.rs` injects the transcribed text into the focused app via clipboard + simulated paste (`keyboard_simulator.rs`).

### Pill overlay window

A small (200×50), transparent, always-on-top, non-focusable window (`pill.rs`, `pill.tsx`/`pill.html` — a **separate Vite entry point**, see `vite.config.ts`'s `rollupOptions.input`) shows live recording/processing status across all workspaces and above fullscreen apps. On macOS it's promoted to an `NSPanel` for fullscreen-app compatibility. If you change pill behavior, you're touching both a Rust window-management module and a distinct frontend bundle — don't assume `src/App.tsx` changes affect it.

### Auth & token storage

Google OAuth 2.0 + PKCE, orchestrated by `google_oauth.rs`; browser flow completion is delivered back over a WebSocket (`websocket.rs`, mirrors `lexi-ai-server`'s Redis-pub/sub OAuth WebSocket). Tokens are stored via `secure_storage.rs`: **debug builds** use a Tauri Store file (`.auth.dat`, avoids repeated keychain prompts during dev); **release builds** use the OS keychain (macOS Keychain / Windows Credential Manager / Linux Secret Service via the `keyring` crate). `commands/session_refresh.rs` runs a background scheduler to proactively refresh the access token before expiry.

### Meeting detection & live transcription

`src-tauri/src/meetings/` has per-OS meeting-app detectors (`detector/macos.rs`, `detector/win.rs`) that emit `meeting-detected` when Zoom/Meet/etc. is foregrounded, plus `meetings/websocket.rs` for streaming live transcription during a recorded meeting. The tray "Start Meeting" item and the detector both feed into the same recording flow.

### System tray

`tray/mod.rs` builds the menu and dispatches on `event.id` strings (`"start_meeting"`, `"view_analytics"`, `"view_usage"`, `"check_updates"`, etc.) — most items call `show_and_focus_main_window` then `app.emit("<action>-from-tray", ())`, which `src/App.tsx` picks up with a `listen()` call to drive `setCurrentPage`/other state. **New tray actions that need to affect the UI follow this emit → listen pattern**, they don't call into React directly. Platform-specific tray extras live in `tray/macos.rs` / `tray/windows.rs`.

### Frontend state

Zustand stores in `src/store/`: `authStore`, `appConfigStore`, `onboardingStore`, `updaterStore`. Page-level state (which page is showing, cross-page trigger flags like "start meeting from tray") lives in `App.tsx`'s own `useState`, not a store — `App.tsx` is the single router (no `react-router` despite it being a dependency; navigation is a `currentPage` string state + conditional rendering, passed down as `onNavigate` callbacks). Sidebar nav order and the `Page`/`SidebarProps` page-name union (`src/types/index.ts`) must be kept in sync when adding a page.

### Server-mirrored types

Several frontend TS interfaces (feature usage, analytics breakdown, transcripts, etc.) and their Rust `#[derive(Serialize, Deserialize)]` struct counterparts intentionally mirror `lexi-ai-server`'s Pydantic DTOs field-for-field. There's no shared schema/codegen — when a server DTO changes shape, update the Rust struct (`src-tauri/src/commands/*.rs`) **and** the TS interface (co-located in the relevant page/component file, not centralized) by hand.
