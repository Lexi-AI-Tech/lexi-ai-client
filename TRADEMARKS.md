# Trademark and Branding Policy

The source code in this repository is licensed under the [MIT License](LICENSE).
The MIT License covers the **code**. It does not grant any rights to Lexi AI's
names, logos, or other branding.

## What is reserved

"Lexi", "Lexi AI", the Lexi logo and app icons (including the files in
`src-tauri/icons/` and any logo or brand artwork in the UI), the `speaklexi.com`
domain and its subdomains, and the application identifier are trademarks or
brand assets of Lexi AI. We reserve all rights in them.

## If you fork or redistribute this project

You are free to fork, modify, and distribute the code under the MIT License.
If you distribute a modified version, please:

- **Use a different name** for your product. Do not call it "Lexi" or "Lexi AI",
  or use a name that could be confused with it.
- **Remove or replace** the Lexi logo and app icons with your own.
- **Change the application identifier** (`identifier` in `src-tauri/tauri.conf.json`)
  and your updater endpoint and signing keys, so your builds do not interact with
  Lexi AI's updates or services.
- **Do not imply** that your version is made, endorsed, or supported by Lexi AI.

## What you may do

- Say that your project is "based on Lexi" or "a fork of Lexi" in a factual way,
  with a link to this repository.
- Refer to Lexi AI by name when describing compatibility or origin.

## Lexi AI services

The Lexi AI servers (`speaklexi.com`) are a separate, proprietary service and are
not covered by the MIT License. Official builds connect to them; forks should not
rely on them without permission.

## Questions

For permission requests or questions about this policy, contact the maintainers
via the repository's issue tracker or the contact listed in `SECURITY.md`.
