# iCloud Mail and iCloud Drive

These are separate features. iCloud Mail uses IMAP; iCloud Drive receives a local
copy that Apple's own Windows client uploads. Bmail does not use CloudKit or ask
for your Apple Account password for cloud backups.

## iCloud Mail

1. Add a mailbox and choose **iCloud**.
2. Enter your full primary iCloud Mail address. The IMAP host is
   `imap.mail.me.com`, using TLS on port `993`.
3. Enable two-factor authentication on your Apple Account and generate an
   app-specific password for Bmail at `account.apple.com`.
4. Paste that app-specific password and save the mailbox. Use the in-app Apple
   password help link for instructions.

Credentials use the existing Windows-encrypted per-account store. Backups and
mail checks remain read-only. The usual folder selection, metadata search and
incremental new-mail checks also apply to iCloud Mail. Aliases or custom-domain
addresses may require using the primary iCloud Mail address for authentication.

Apple references: [Mail server settings](https://support.apple.com/102525) and
[app-specific passwords](https://support.apple.com/102654).

## iCloud Drive folder copies on Windows

1. Install and sign in to **iCloud for Windows**, and enable iCloud Drive.
2. Open **Preferences > Cloud backup > iCloud Drive** and choose your existing
   local iCloud Drive folder. Bmail creates its own `Bmail` subfolder and an
   independent destination for each mailbox.
3. Complete a local backup, then choose **Copy backup now**. Optionally enable
   **Copy after local backups**; automatic copying is off until you enable it.
4. Keep the resulting Bmail folder downloaded using **Always keep on this device**
   in File Explorer, so repeat integrity checks do not need to download evicted files.

The copy contains only verified `.eml` messages and their backup manifest.
Credentials, app configuration, logs and the SQLite cache are excluded. Unchanged
files are verified and skipped. Message files use their SHA-256 hashes as names
inside `messages/`; the manifest retains their folder identities and message
metadata. New files are copied and verified before the manifest is replaced, so
an interrupted copy leaves the previous complete manifest usable. Old message
files are retained; Bmail does not delete files in the iCloud destination.

**Copied locally** and **Last local copy** confirm only the local filesystem copy.
Apple manages the subsequent upload, account storage limits and synchronization.
Bmail cannot confirm that an upload has completed. Check iCloud for Windows or
iCloud.com to verify remote availability. Choosing an ordinary folder will not
make it sync: select a folder actually managed by iCloud for Windows.

Changing the destination turns automatic copying off. Cancelling the folder
picker preserves the current destination. **Remove destination** clears this
mailbox's setting and automatic copying, while retaining copied files. Failed
copies do not change the outcome of the local mailbox backup.

Each account's folder selection and status live in its private application-data
profile as `cloud-icloud.json`. No Apple API token is stored for this feature.

Apple reference: [iCloud Drive on Windows](https://support.apple.com/guide/icloud-windows/icwddbc813bd/icloud).

## Validation

`npm.cmd test` includes copy integrity, repair, cancellation, account isolation,
directory containment, interrupted copies, automatic queuing, and encrypted mail
setup tests. `npm.cmd run test:stats:ui` exercises the preset and copy controls with
synthetic accounts. Live Apple authentication, the real folder-picker interaction,
and Apple's eventual cloud upload require manual verification on a configured PC.
