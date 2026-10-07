# Contributing to Lexi AI Client

Thanks for your interest in contributing! This guide covers how to get set up and what we look for in a pull request.

By participating, you agree to follow our [Code of Conduct](CODE_OF_CONDUCT.md). To report a security issue, see [SECURITY.md](SECURITY.md) instead of opening a public issue.

## Ways to contribute

- Report bugs or request features through [issues](../../issues/new/choose).
- Improve documentation.
- Pick up an open issue. For anything non-trivial, comment first so we can agree on an approach before you invest time.

## Development setup

Follow the [README](README.md#prerequisites) for prerequisites, then:

```bash
npm install
npm run dev
```

Debug builds talk to a local `lexi-ai-server` on port 3000. See the README for details.

## Project conventions

- **Frontend (`src/`)** calls Rust only through `invoke()` and `listen()` from `@tauri-apps/api`.
- **Server calls go through Rust.** To add an endpoint, add a Rust struct and a `#[tauri::command]` under `src-tauri/src/commands/` (or the relevant feature module), and register it in the `tauri::generate_handler![...]` list in `main.rs`. An unregistered command fails only at runtime.
- **Server-mirrored types** exist in both Rust (`serde`) and TypeScript. When a server response changes, update both by hand. Serde silently drops unknown fields.
- **Navigation** is state in `App.tsx` (not `react-router`). Keep the `Page` union in `src/types/index.ts` and the sidebar in sync when adding a page.
- **New tray actions** that affect the UI emit an event from Rust and are handled with `listen()` in `App.tsx`.
- The **pill overlay** is a separate Vite entry (`pill.html`); changes to `src/App.tsx` do not affect it.

## Code style

Run the formatter before committing:

```bash
npm run format
```

This runs `cargo fmt` and Prettier. Keep new code consistent with the surrounding code in naming, comment density, and idiom.

## Testing your change

There is no automated test suite yet. Please verify your change manually in `npm run dev` and note what you tested in the PR. If your change touches platform-specific code (`macos.rs`, `win.rs`, hotkeys, text injection), say which OS you tested on.

## Pull requests

1. Fork the repo and create a branch from `main` (for example `fix/pill-flicker` or `feat/export-transcript`).
2. Keep PRs focused: one logical change per PR.
3. Write clear commit messages that explain _why_.
4. Fill in the pull request template, including screenshots or recordings for UI changes.
5. Make sure `npm run build:frontend` and `cargo check` (in `src-tauri/`) pass.

A maintainer will review your PR. We may ask for changes; please be patient, as this is a small team.

## Secrets and signing

Never commit `.env` files, signing keys, API keys, or tokens. `.env.sample` documents variables that only maintainers need for signed releases.

## Licensing and trademarks

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE). The Lexi name and branding are not covered by that license; see [TRADEMARKS.md](TRADEMARKS.md).
