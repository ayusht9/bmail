# Backup statistics

The desktop workspace has an account and folder sidebar, a coverage table and
recent saved records in the centre, and account statistics on the right. Select
a folder to narrow the tables; use Filter folders to find a folder by name.
Mailbox-check failures remain visible with diagnostic details and Retry until
dismissed or successfully retried. Activity log opens from the sidebar.

The dashboard shows the active account's saved message count, recorded email
bytes, downloads in the last run, recent saved mail, and per-folder coverage.
Totals count each saved folder copy; Gmail labels may contain the same email in
several folders. Retained messages from deleted server mail or older UIDVALIDITY
generations remain included in local totals.

**Check mailbox** connects read-only, enumerates every accessible folder and all
message UIDs, and verifies matching local files against their recorded size and
SHA-256. It downloads no message bodies. It ignores the current backup selection
so a partial date range, selected folders, or a download limit cannot be mistaken
for a full mailbox backup. This check can take time for large backups because it
verifies local files. It cannot run alongside a backup or another mailbox check.

Full backup means every message enumerated in every accessible server folder has
a complete, valid local copy during the displayed check. Folders are checked in
turn; new mail arriving during or after the check may not be included. Local totals
come from manifest records; use the mailbox check to detect missing/damaged files.
A successful backup also attempts to refresh these statistics.
Failed checks retain the previous snapshot and its timestamp. The last confirmed
full-backup date remains visible when newer mail makes coverage incomplete.

**New on server** compares the latest successful mailbox inventory with the
previous one. The first check has no baseline. If UIDVALIDITY changes, new-mail
counts become unknown until another check instead of claiming all mail is new.
**Still to back up** includes both never-downloaded mail and missing/damaged local
copies. **Downloaded last run** may include replacement downloads for repaired
files; it is separate from newly discovered server mail.

Snapshots are stored in each account's backup directory as `mailbox-status.json`.
No network checks occur on the dashboard refresh timer. Use Check mailbox to find
mail received since the previous check. Email credentials, backups, and snapshots
stay outside source control.

Application updates are installed manually. OTA startup checks, update commands,
signing dependencies, and automatic release publication are disabled/removed.
Run `npm.cmd run tauri:build` for the Windows installer. Test manual installation
and upgrade on a clean Windows machine before distributing a public release.
