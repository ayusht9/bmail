# Microsoft Store: free MSIX publication

Status: packaging source prepared; no MSIX built, installed, certified or submitted.
The existing NSIS distribution is unchanged. Do not buy a certificate for Store-only
MSIX publication: Microsoft signs certified Store packages.

## Account and identity

1. Begin at https://storedeveloper.microsoft.com (the free onboarding flow).
2. Select Individual when publishing under your own name; complete Microsoft's
   identity verification privately. Never put identity documents in this repository.
3. Reserve an available product name and choose the MSIX/PWA submission route,
   not EXE/MSI.
4. Under Product identity, copy `Package/Identity/Name`,
   `Package/Identity/Publisher` and `Package/Properties/PublisherDisplayName`.
   The Tauri identifier `com.bmail.desktop` is not the Store-assigned identity.

## Packaging (only when a release build is requested)

The free Windows SDK supplies MakeAppx. The script currently targets x64 only.
It uses the existing icon to generate package logos, escapes identity values,
and maps the beta version `0.x.y` to the Store package version `0.x.y.0`.
The fourth component remains zero for Store submission.

Validate inputs without generating an app or package:

```powershell
./scripts/package-store.ps1 -IdentityName 'COPY_FROM_PARTNER_CENTER' `
  -IdentityPublisher 'CN=COPY_FROM_PARTNER_CENTER' `
  -PublisherDisplayName 'YOUR_REGISTERED_PUBLISHER' -ValidateOnly
```

When authorized, create a fresh release and then package it:

```powershell
npm.cmd test
npm.cmd run build
npm.cmd run tauri -- build --no-bundle
./scripts/package-store.ps1 -IdentityName 'COPY_FROM_PARTNER_CENTER' `
  -IdentityPublisher 'CN=COPY_FROM_PARTNER_CENTER' `
  -PublisherDisplayName 'YOUR_REGISTERED_PUBLISHER'
```

Do not use an old executable or runtime. The script packages the existing release
without rebuilding and does not verify that it matches the current sources.
Generated packages and layouts go in ignored `.store-output/` folders.
Only the release EXE and prepared engine runtime are copied, never mailbox data.
Upload the resulting unsigned MSIX to Partner Center after compatibility testing.
Local installation needs a separate development signing procedure; Microsoft
Store signing happens after submission. Do not disable Windows signature checks.

## Required compatibility gates

- Validate package schema with MakeAppx and run the Windows App Certification Kit.
- Test the installed MSIX on a clean x64 Windows environment with WebView2 present.
  The MSIX path bypasses NSIS, so it does not run the WebView2 bootstrapper. Resolve
  and test provisioning on devices missing WebView2 before claiming support there.
- Verify the bundled Node executable, PowerShell processes, mailbox setup, app
  password encryption, backups, reader, search, exports and cloud authorization.
- Verify writes go to user data, never the read-only WindowsApps installation.
- Test scheduled backups while closed and after a Store package update. Existing
  schedules reference the installed engine path, which changes on MSIX updates.
  A stable activation strategy or schedule repair may be needed before release.
- Test coexistence/migration with an NSIS installation, and backup retention on
  uninstall. Explain Store data removal accurately to users.
- Test sleep/wake, tray exit, offline startup, and upgrade with an active backup.
- Review dependency licenses and included files for private data before uploading.

The manifest requests `runFullTrust`: Bmail is a desktop app using bundled Node,
PowerShell, local files and per-user scheduled tasks. Explain this in certification
notes if Partner Center requests justification. It does not request administrator
elevation.

## Listing and privacy

Prepare a public privacy-policy URL and support URL, product description, feature
list, screenshots with fictional mail, category, markets, age rating, and free
pricing. Existing GitHub Pages hosting can host these pages at no hosting cost.
Do not publish a privacy policy until it has been checked against actual behavior.
Cover mailbox credentials/tokens, local message/attachment storage, Windows
credential protection, provider connections, optional Drive/Dropbox/iCloud copies,
diagnostic logs, retention, deletion, and a real support contact. Avoid claiming
that data never leaves the device: mail providers and optional cloud copies use
network connections.

Suggested short description: **Local, read-only email backups for Windows.**

Suggested listing text:

> Keep a local copy of your Gmail, Zoho, iCloud Mail or other supported IMAP
> mailbox. Bmail saves messages as standard .eml files and provides a searchable
> desktop reader, incremental backups, multiple accounts and optional cloud
> copies. Bmail reads your mailbox without deleting, moving or flagging messages.
> A compatible email account and provider-specific setup are required.

Do not advertise Outlook support until it is released. Certification instructions
must explain how to reach useful functionality and test account-dependent flows;
use a dedicated test mailbox if credentials are needed, never a personal mailbox.
Put test credentials only in Partner Center's private certification notes.

## Official references

- Free enrollment: https://learn.microsoft.com/en-us/windows/apps/publish/partner-center/open-a-developer-account
- MSIX packaging: https://learn.microsoft.com/en-us/windows/msix/desktop/desktop-to-uwp-manual-conversion
- Store readiness: https://learn.microsoft.com/en-us/windows/apps/publish/store-readiness-checklist
- Packaged desktop behavior: https://learn.microsoft.com/en-us/windows/msix/desktop/desktop-to-uwp-behind-the-scenes
- WebView2 deployment: https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution
