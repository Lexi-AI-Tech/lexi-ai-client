# Security Policy

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues, discussions, or pull requests.**

Use GitHub's private vulnerability reporting instead:

1. Go to the **Security** tab of this repository.
2. Click **Report a vulnerability**.
3. Describe the issue and, if possible, include steps to reproduce.

### What to include

- A description of the vulnerability and its potential impact
- The affected version (see `package.json`) and operating system
- Steps to reproduce, or a proof of concept
- Any suggested mitigation

## What to expect

- We aim to acknowledge reports within **5 business days**.
- We will keep you updated as we investigate and work on a fix.
- We will credit you in the release notes if you wish, once a fix is available.

Please give us reasonable time to release a fix before any public disclosure.

## Supported Versions

Only the latest released version of Lexi AI receives security fixes.

## Scope

In scope:

- This repository: the Tauri/Rust app, the React frontend, local storage of tokens and configuration, and the build and release scripts.

Out of scope:

- The hosted Lexi backend and website (`speaklexi.com` and its subdomains). If you find an issue there, report it through the same private channel and we will route it appropriately.
- Vulnerabilities in third-party dependencies with no demonstrated impact on Lexi. Report those upstream.
- Social engineering, physical attacks, and denial-of-service testing against production services.

## Safe harbor

We will not pursue action against researchers who make a good-faith effort to follow this policy, avoid privacy violations and service disruption, and give us a reasonable chance to fix issues before disclosure.

## Secrets

If you find a leaked credential, signing key, or token in this repository or its history, report it privately as above. Do not use it.
