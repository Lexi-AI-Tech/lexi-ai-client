# Open-Source Readiness Checklist

## Decisions

- [ ] **Branding**
  - [ ] Keep Lexi name/logo/`speaklexi.com` links as yours
  - [ ] Add a trademark note: forks must rename
- [ ] **Updater and signing**
  - [ ] Updater endpoint and public key are fine to publish
  - [ ] Ensure the private signing key and Apple signing/notarization secrets live only in CI secrets
  - [ ] Review or remove `.github/APPLE_SIGNING_SETUP.md`
  - [ ] Make sure forks' CI cannot publish via the release workflows
- [ ] **Third-party code and assets**
  - [ ] Confirm rights to fonts, icons, sounds, models, bundled binaries

## Cleanup

- [ ] Review `CLAUDE.md`, `changelog`, and code comments for internal servers, customer data, or credentials
- [ ] Generalize comments referencing `lexi-ai-server/modules/...` internals
- [ ] Add `.env.production` to `.gitignore` (it is currently tracked)
- [ ] Keep `.env.sample` with placeholders only
- [ ] Search for hardcoded internal URLs, analytics keys, Sentry DSNs, test accounts, personal emails

## Files to add

- [ ] `README.md` (screenshots, Tauri/Rust/Node prerequisites, build and run steps)
- [ ] `CONTRIBUTING.md`
- [ ] `CODE_OF_CONDUCT.md`
- [ ] `SECURITY.md` (private vulnerability reporting)
- [ ] Issue and PR templates
- [ ] CI workflow for lint, build, and tests on PRs
- [ ] GitHub settings: branch protection, Dependabot, secret scanning + push protection, disable workflows on forks if needed

## Legal and privacy

- [ ] Document what data leaves the device (audio/meeting recording) and where it goes
- [ ] Review Terms and Privacy pages
- [ ] Choose DCO sign-off or CLA (if relicensing later is possible)
- [ ] Get sign-off from company/co-founders
- [ ] Confirm no employer or client owns code in the repo
