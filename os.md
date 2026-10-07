# Open-Source Readiness Checklist

## Cleanup

- [ ] Test the new CSP (`csp` / `devCsp` in `tauri.conf.json`): run `npm run dev` and a production build, click through every screen and the pill, and check the console for "Refused to…" errors
- [ ] Fix or remove `checkUpdateDetails` (reads undefined `VITE_API_BASE_URL`; update size/notes never load)
