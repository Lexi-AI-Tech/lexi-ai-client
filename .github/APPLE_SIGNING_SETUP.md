# Apple Signing Setup for GitHub Actions

This guide is for the person who has the **Developer ID Application** certificate (e.g. Satyasai) to export it once and add GitHub secrets so the team can build the signed + notarized macOS app via Actions without needing the .p12 file locally.

---

## 1. Confirm the certificate on your Mac

1. Open **Keychain Access**.
2. Select the **login** keychain and the **My Certificates** category.
3. Find **"Developer ID Application: Satyasai Vallampati (FWLCJN85BF)"**.
4. Expand it (click the arrow) and confirm there is a **private key** listed under it.  
   If there is no private key, the certificate cannot be exported for CI; a new certificate would need to be created from this Mac.

---

## 2. Export the certificate as a .p12 file

1. In Keychain Access, expand **"Developer ID Application: Satyasai Vallampati (FWLCJN85BF)"**.
2. **Right-click the private key** (the key icon under the certificate), not the certificate line.
3. Choose **"Export [key name]"** (or **Export…**).
4. Save as **.p12** (e.g. `lexi-developer-id.p12`).
5. When prompted, set a **strong password** and remember it — this will be **APPLE_CERTIFICATE_PASSWORD**.
6. Store the `.p12` file somewhere safe; **do not commit it to git**.

---

## 3. Convert the .p12 to base64 (for GitHub secret)

On the same Mac, in Terminal:

```bash
base64 -i /path/to/lexi-developer-id.p12 -o certificate-base64.txt
```

Replace `/path/to/lexi-developer-id.p12` with the actual path. Open `certificate-base64.txt` and copy **all** of its contents (one long line). This is the value for the **APPLE_CERTIFICATE** secret.

---

## 4. Create an app-specific password (for notarization)

1. Go to [appleid.apple.com](https://appleid.apple.com) and sign in with the **same Apple ID** used for the Developer account.
2. Open **Sign-In and Security** → **App-Specific Passwords** → **Generate**.
3. Name it (e.g. "Lexi CI notarization").
4. Copy the generated password (format like `xxxx-xxxx-xxxx-xxxx`).  
   This is the value for **APPLE_APP_SPECIFIC_PASSWORD**.

---

## 5. Get the Team ID

1. Go to [developer.apple.com/account](https://developer.apple.com/account).
2. Sign in → **Membership** (or **Account** → membership).
3. Copy the **Team ID** (e.g. `FWLCJN85BF`).  
   This is the value for **APPLE_TEAM_ID**.

---

## 6. Add secrets in GitHub

In the **lexi-ai-client** repository:

1. Go to **Settings** → **Secrets and variables** → **Actions**.
2. Click **New repository secret** and add each of the following:

| Secret name                     | Value                                                                                            |
| ------------------------------- | ------------------------------------------------------------------------------------------------ |
| **APPLE_CERTIFICATE**           | The entire contents of `certificate-base64.txt` (the base64 string)                              |
| **APPLE_CERTIFICATE_PASSWORD**  | The password you set when exporting the .p12 in step 2                                           |
| **KEYCHAIN_PASSWORD**           | Any strong random string (e.g. from a password manager); used only for the temporary CI keychain |
| **APPLE_ID**                    | The Apple ID email used for the Developer account                                                |
| **APPLE_APP_SPECIFIC_PASSWORD** | The app-specific password from step 4                                                            |
| **APPLE_TEAM_ID**               | The Team ID from step 5                                                                          |

---

## 7. Run the workflow

1. Go to **Actions** → **"Build & Sign macOS App"**.
2. Click **Run workflow** → **Run workflow**.

The workflow uses the certificate from the secrets (no .p12 file is shared with the team). The first run may take several minutes. The signed (and notarized) app will be in the workflow artifacts or the bundle path shown in the logs.

---

## Checklist

- [ ] Export Developer ID Application certificate’s **private key** as **.p12** and note its password.
- [ ] Run `base64 -i ... .p12 -o certificate-base64.txt` and copy the full content.
- [ ] Create an **app-specific password** at appleid.apple.com.
- [ ] Get **Team ID** from developer.apple.com/account.
- [ ] Add all **6 secrets** in the repo’s GitHub Actions settings.
- [ ] Run the **"Build & Sign macOS App"** workflow once to verify.

After this one-time setup, anyone with access to the repo can run the workflow to produce a signed and notarized build; no one else needs the .p12 file.
