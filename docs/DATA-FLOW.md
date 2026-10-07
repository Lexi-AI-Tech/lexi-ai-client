# Data Flow: What Leaves Your Device

This document describes what the Lexi AI desktop client sends off-device, where it goes, and what stays local. It is based on reading the client source (`src-tauri/src/`) and the `lexi-ai-server` backend. It is a technical description, not a legal notice; the legal terms are in the [Privacy Policy](https://www.speaklexi.com/privacy) and [Terms](https://www.speaklexi.com/terms).

If you find a discrepancy between this document and the code, please open an issue (or report privately, see [SECURITY.md](../SECURITY.md)).

## Summary

- The client has **no local speech-to-text**. Audio you record is sent to the Lexi server (`https://server.speaklexi.com` in release builds; `http://localhost:3000` in debug builds) for transcription.
- All client network traffic goes to the Lexi server, plus Google for sign-in. The client contains no third-party analytics SDK (no PostHog, Sentry, etc.).
- The server forwards audio and text to third-party AI providers to produce transcripts and AI output.
- Nothing is sent unless you trigger a feature (hotkey dictation, an Action, a meeting recording, a Doc voice input, or sign-in).

## What is sent, by feature

| Feature | Data sent from the device | Transport | Source |
| --- | --- | --- | --- |
| **Dictation** (hotkey) | Recorded audio as WAV; focused app name; language; custom vocabulary; shortcuts; "enhance transcription" flag | HTTPS multipart `POST /api/v1/assistant` | `assistant/service.rs` |
| **Actions** (voice command) | Recorded audio as WAV; app name; language; vocabulary; **selected text** at the cursor, if any | HTTPS multipart `POST /api/v1/actions/perform` | `actions/service.rs`, `cursor_context/` |
| **Docs voice input** | Recorded audio as WAV | HTTPS multipart `POST /api/v1/docs/create-doc-from-audio` | `docs/` |
| **Meeting recording** | Live **microphone audio** and, on macOS, **system audio** (the other participants), streamed in chunks; typed meeting notes; language; meeting id | Secure WebSocket (`wss`) to the server | `meetings/websocket.rs`, `audio/meeting.rs` |
| **Meeting summary** | Request for a summary of a recorded meeting (the server already holds the transcript) | HTTPS (streamed response) | `meetings/commands.rs` |
| **Sign-in** | Google OAuth 2.0 + PKCE; the server receives your Google profile (name, email) | HTTPS; browser flow, completed over WebSocket | `google_oauth.rs`, `websocket.rs` |
| **Account/app config** | Auth token; hotkey and preference settings; device and system type (for cache warmup); app version and target (for update checks) | HTTPS | `api_endpoints.rs`, updater |
| **Analytics/usage pages** | Requests for your own usage data (the client reads it; it does not upload telemetry) | HTTPS | `commands/analytics.rs` |

### Context captured from other apps

When you use dictation or an Action, the client reads limited context from the active application:

- The **focused application name** (sent with dictation and Action requests).
- The **currently selected text**, obtained by temporarily simulating a copy command (Cmd/Ctrl+C), reading the clipboard, and then restoring your previous clipboard contents (`cursor_context/mod.rs`). This is sent only for Actions.

The client contains no screenshot or window-content capture code. (On macOS it links to the Screen Recording permission pane, which is the permission system-audio capture needs for meetings.)

Note: the published Privacy Policy describes context awareness as collecting "limited on-screen text from the active application". The code reads the selected text and the app name only. See [Discrepancies](#discrepancies-to-resolve).

## What stays on the device

- **Auth tokens**: OS keychain (macOS Keychain, Windows Credential Manager) in release builds; a local Tauri Store file (`.auth.dat`) in debug builds.
- **App configuration**: a Tauri Store file (`.app-config.dat`) in the app data directory.
- **Clipboard**: your clipboard is read and restored during selected-text capture and during text injection (paste). Its contents are not retained.
- **Raw audio**: held in memory for the duration of a recording and sent to the server. The client does not write your recordings to disk. The only audio file it writes is the text-to-speech reply from an Action, saved to a temporary directory for playback (`tts_service.rs`).

## Where it goes after the device

Server-side processing is in `lexi-ai-server`. As of this writing, the server integrates with these third parties:

| Purpose | Provider(s) in code | What they receive |
| --- | --- | --- |
| Speech-to-text | Groq, Deepgram, ElevenLabs, Cartesia (selected per request) | Audio |
| LLM processing (enhancement, Actions, summaries, analytics) | OpenAI, Groq, Cerebras | Transcript text, selected text, prompts |
| Text-to-speech (Actions) | ElevenLabs | Text to be spoken |
| AI memory | Zep Cloud | Meeting summaries / doc content ingested for later retrieval |
| Payments | Paddle (Merchant of Record) | Billing details, handled by Paddle |
| Infrastructure | Google Cloud Storage (app update artifacts), Redis (cache) | Release binaries; cache entries |

The server-side retention claims (for example, that raw audio is not stored) are made in the Privacy Policy. A grep of the server found no code that persists uploaded dictation audio (GCS is used only for update artifacts), but this should be confirmed by the backend owners, including provider-side retention settings.

## Discrepancies to resolve

These were found while comparing the code to the Privacy Policy and Terms pages (`lexi-ai-web/src/pages/PrivacyPage.tsx`, `TermsPage.tsx`, both dated April 16, 2026):

1. **Zep Cloud is not disclosed.** Meeting summaries and docs are ingested into Zep for AI memory, but the policy's third-party list covers only cloud hosting, LLM providers, Paddle, and PostHog.
2. **Named providers.** The policy refers to "AI language model providers" generically. Speech-to-text and text-to-speech vendors (Groq, Deepgram, ElevenLabs, Cartesia) also receive user audio or text and are not categorized as such. Consider listing sub-processors.
3. **Context awareness wording.** The policy says on-screen text is collected; the client reads selected text and the app name. Either wording or behavior should be aligned. The policy also says it can be disabled in app settings: confirm that a setting exists.
4. **Meeting system audio.** Meeting recording captures other participants' audio. The Terms ask users to obtain consent where required, but the policy does not call out third-party voices explicitly.
5. **PostHog.** The policy lists PostHog analytics. The client has no PostHog code; confirm whether it applies only to the website, and say so in the policy. Also confirm the claimed "disable analytics in account settings" control exists.
6. **"No AI training" and "not stored" claims.** These are strong commitments; verify them against each provider's data-handling agreement and settings before relying on them.
7. **Terms.** Governing law is "applicable laws" with no jurisdiction or venue, and the Terms contain no entity address. The legal entity is "Lexi AI Tech" in the Terms and Privacy pages but "Lexi AI" in `LICENSE` and the app's copyright string. Align the names.
8. **Support contact.** The only listed contact is `support@speaklexi.com`; there is no data protection or privacy-specific contact, which GDPR requests typically need.
