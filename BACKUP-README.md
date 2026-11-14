# Zoho local email backup

Account: ayushkumar@integramicro.co.in. Server: imappro.zoho.in:993 over verified TLS.

## Desktop dashboard

The optional **Mail Vault** Tauri app shows the latest backup result, folder
coverage, saved-message count and recent log output. It can start a backup,
verify local files, install or update the weekly schedule, and open the backup
or log folders. It calls the same read-only scripts documented below and never
reads or displays the saved password.

For development, install the Windows prerequisites for Tauri 2 (Rust via
`rustup` and Visual Studio Build Tools with the Desktop development with C++
workload), then run:

```powershell
npm install
npm run tauri:dev
```

The dashboard expects to run from this project directory because the backup
configuration, encrypted credential, messages, and logs remain here. Run
`Setup-Backup.cmd` once before using **Back up now** in the app.

## Activate

1. In Zoho IMAP settings, enable **Include Archived emails** and expose every folder you want backed up under **Folder Settings**. IMAP can only back up what Zoho exposes.
2. Generate a Zoho **application-specific password** in Zoho Accounts > Security (required with MFA). Keep it private; do not paste it into chat or any source file.
3. Double-click `Setup-Backup.cmd` in this directory. Enter the password at the hidden local prompt. Setup performs the first full backup before it registers a scheduled task.

The task runs weekly on **Monday at 11:00 in the Windows local timezone**. It runs as your current user, while signed in, with standard permissions. The computer must be on and have internet access; missed weekly runs are requested when available. Check Windows is set to India time if you want 11:00 IST. If task registration is refused by your organization's policy, manual backups still work; no schedule is active until setup reports success.

Credentials are encrypted using Windows DPAPI by `Export-Clixml`, with the credential directory restricted to your Windows user. They can be decrypted by that user on this computer. The scripts pass the password through standard input, never as a process argument or in a log. Email files themselves are ordinary, unencrypted `.eml` files; protect the drive and any additional copies accordingly. Keep this directory at its current path after scheduling.

## What is saved

`backups/messages/` holds full original `.eml` messages, including embedded attachments and inline images. Messages are grouped by mailbox folder and month, for example `INBOX__<folder-id>/2026-10/2026-10-15_accounts@example.com_Invoice__123.eml`. Filenames include the email date, sender, decoded subject, and unique IMAP UID to avoid overwriting repeated subjects. The sender uses the From address when enclosed in angle brackets, otherwise the decoded From header, with `Unknown sender` as fallback. Sender and subject portions are shortened to 45 and 70 characters respectively. Dates use India time (Asia/Kolkata), using the message Date header with the server's internal date as fallback. Missing dates go into `Unknown-month`. Characters Windows cannot use in filenames are replaced. Folder IDs preserve separate mailbox generations.

Cloud file links do not download the linked files. Open `.eml` files with Thunderbird or another compatible email app. `backups/manifest.json` maps file paths and UIDs to Zoho folder names, and records file sizes, SHA-256 hashes and message metadata. `exports/` holds the original manual export ZIPs and their audit report; these archives contain older emails beyond the current mailbox and are kept separately from the incremental backups.

To organize existing saved messages without connecting to Zoho, run `node .\backup.cjs --organize`. This verifies each email, saves and verifies its new copy, updates the manifest, and then removes the old copy. Original email contents and attachments are unchanged. It can safely be rerun after an interruption. Manual export ZIPs are left intact.

The backup opens each accessible folder in **read-only** mode, checks every existing local message, and downloads missing or damaged copies. Each message is persisted and verified before progress is recorded. Interrupted runs resume on the next run. Local emails remain after a message or folder is deleted from Zoho. Changes to IMAP UIDVALIDITY create a separate folder generation, preserving earlier backups. Folder moves may produce additional local copies.

## Check and run

Run a backup manually from PowerShell:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Run-Backup.ps1
```

Verify all previously recorded local email files without connecting to Zoho:

```powershell
node .\backup.cjs --verify
```

Review `backups/last-run.json`: `success` must be `true`. It lists accessible folders and counts for the last run. Review `logs/` or Task Scheduler's **Last Run Result** if a scheduled backup fails. A successful run covers the folders exposed over IMAP, not any hidden or excluded folders. No background notification service is installed.

Temporary socket/connection failures are retried up to three attempts, waiting 30 then 60 seconds between attempts. Completed downloads are reused. Failed runs record an error and the current folder/UID in `last-run.json`. Both standard output and standard error are captured in the run log. Setup reuses an existing encrypted credential; to replace it, run `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Setup-Backup.ps1 -ResetCredential`.

Downloads fetch metadata separately and retrieve original email bytes in 256 KB partial requests, checking the returned UID and offsets. They continue through an actual zero-byte response at the end of the message: Zoho's reported RFC822.SIZE can underestimate the source length, so size alone is not a completion check. The manifest records both the reported size and actual saved bytes. IMAP compression is disabled for compatibility. Larger emails show transfer progress. First backups can be slow; leave the PC awake and online. After account access has been validated, `Install-BackupSchedule.ps1` can also register the task independently of an ongoing initial transfer. Start it in Task Scheduler to let the first backup continue independently of a terminal window. The task has a two-day execution limit to accommodate slow initial transfers and does not overlap itself.

## Recover Zoho storage

Backups alone do not free mailbox storage. After a successful full backup, compare folder coverage and counts with Zoho, open representative local emails and attachments, and keep a second copy of the exports and `backups` directory on another drive. Then remove only the backed-up older emails from Zoho and permanently clear those items from Trash. This script has no delete, move, flag-update or expunge operation. Automatic server cleanup has deliberately not been configured; choose a retention period before implementing it.

To stop scheduling:

```powershell
Unregister-ScheduledTask -TaskName 'Zoho Mail Backup - ayushkumar@integramicro.co.in' -Confirm:$false
```

Source documentation: [Zoho IMAP settings](https://www.zoho.com/mail/help/imap-access.html), [Zoho application passwords](https://www.zoho.com/mail/help/adminconsole/two-factor-authentication.html).
