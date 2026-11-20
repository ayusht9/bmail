# Google Drive cloud backup

Bmail can copy a mailbox's verified local archive to Google Drive. Local backups
remain the primary archive. Drive setup and automatic upload preferences belong
to each mailbox, so Gmail, Outlook, Zoho, and custom IMAP accounts can all use a
Google Drive destination independently of their mail provider.

## One-time Google setup

This beta does not ship with a registered Google OAuth application. Register one
before connecting; no paid Bmail server or service account is required.

1. Create or select a project in the [Google Cloud console](https://console.cloud.google.com/).
2. Enable **Google Drive API** for that project.
3. Configure Google Auth Platform's consent screen and audience. For an external
   app in Testing, add the Google account you will connect as a test user.
4. Create an OAuth client with application type **Desktop app**. Download its
   JSON file. A Web application client or service account key will not work.
5. Select your mailbox in Bmail, then open **Preferences → Cloud backup →
   Set up Google Drive** and select that JSON file in the Windows file picker.
6. Click **Connect Google Drive**, grant access in your normal browser, and return
   to Bmail. Bmail listens only on an ephemeral localhost port for this sign-in,
   validates a random state, and uses PKCE. Sign-in times out after three minutes.
7. Click **Back up to Drive now**, or enable **Upload to Drive after successful
   local backups**. Automatic uploads also run for Windows scheduled backups and
   directly downloaded individual messages.

Google controls OAuth testing and publishing requirements. Testing-mode refresh
tokens with Drive access can expire after seven days; reconnect if access expires.
Register and publish an application appropriately before distributing it broadly.
Never commit the downloaded OAuth JSON file, tokens, account configuration, or
generated runtime files. Import is local; credentials do not go through chat.

## What is uploaded

The destination is a `Bmail - <mailbox address>` folder in My Drive. Bmail
recreates the archive's relative email folders and filenames and uploads
`manifest.json` after the email files complete. It validates local file sizes and
SHA-256 hashes and checks the returned Drive MD5 checksum before marking a file
uploaded. Unchanged cloud files are skipped; changed or repaired local files are
updated in place. Missing local files cause an error rather than an incomplete
manifest being published.

Only manifest-listed, complete `.eml` files and the manifest are uploaded.
Passwords, tokens, OAuth client files, logs, local caches, settings, and partial
downloads are excluded. Email contents are stored as normal files in your Google
Drive; Bmail does not add client-side archive encryption in this version.

Uploads use resumable sessions in bounded chunks, probe the server after a lost
response, refresh expired access tokens, and retry temporary failures and rate
limits. A retry skips files whose remote checksums already match. After a restart,
the current unfinished file may restart from the beginning; completed files are
not uploaded again. If a local backup finishes during an existing cloud sync,
another sync is queued to include the latest manifest.

## Status, disconnect, and recovery

Preferences shows the connected Google account, destination folder, last
successful cloud backup, progress, and actionable errors. Quota or network
failures leave local backup success and local email bytes intact. With automatic
upload enabled, a later successful backup tries cloud upload again. Manual retry
is always available while connected.

Cloud access credentials are encrypted with Windows DPAPI and kept in the
mailbox's owner-only `.private` directory. Disconnect removes the saved tokens for
that mailbox, disables automatic upload, and retains both local and Drive files.
It does not revoke Google's shared app grant, which could disconnect other Bmail
mailboxes using the same Google OAuth application. To revoke that grant entirely,
remove the application in your Google Account's third-party access settings.

This first version provides one-way backup, not two-way synchronization or a
restore wizard. Bmail never deletes cloud files when a local file disappears.
For manual recovery, download the complete Drive destination folder and extract
it so `manifest.json` and `messages` are directly inside the restored archive
folder. Preserve all relative paths. With Bmail closed, retain a copy of any
existing archive, then put the restored archive at the configured backup location
for the matching mailbox. Verify the local archive before continuing backups.
Mailbox credentials and schedules must be set up separately; they are not backed
up to Drive.

## Validation

Run `npm.cmd test`, `npm.cmd run build`, and
`cargo check --manifest-path src-tauri/Cargo.toml --lib` for source validation.
The tests simulate Google OAuth and the Drive HTTP API, including interrupted
uploads, checksums, permissions, quota, incremental updates, and DPAPI storage.
A real Google account smoke test requires the registered desktop OAuth app above.
No desktop executable or installer is generated by these source checks.

References: [Google desktop OAuth](https://developers.google.com/identity/protocols/oauth2/native-app),
[Drive access scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth),
[resumable uploads](https://developers.google.com/workspace/drive/api/guides/manage-uploads).
