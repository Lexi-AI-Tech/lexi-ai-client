# Open-Source Readiness Checklist

## Cleanup

- [ ] Review `CLAUDE.md`, `changelog`, and code comments for internal servers, customer data, or credentials
- [ ] Set a Content Security Policy (`"csp": null` in `tauri.conf.json`)
- [ ] Fix or remove `checkUpdateDetails` (reads undefined `VITE_API_BASE_URL`; update size/notes never load)
- [ ] Resolve the 28 Dependabot alerts (12 high, 13 moderate, 3 low)
- [ ] Fix `build-release.sh` references in `CLAUDE.md`/`README.md` (the script does not exist)

## Files to add

- [ ] CI workflow for lint, build, and tests on PRs
- [ ] GitHub settings: branch protection, Dependabot, secret scanning + push protection, disable workflows on forks if needed

## Legal and privacy

- [ ] Document what data leaves the device (audio/meeting recording) and where it goes
- [ ] Review Terms and Privacy pages
- [ ] Choose DCO sign-off or CLA (if relicensing later is possible)
- [ ] Get sign-off from company/co-founders
- [ ] Confirm no employer or client owns code in the repo
