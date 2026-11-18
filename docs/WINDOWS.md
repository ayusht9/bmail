# Bmail for Windows

Bmail uses Tauri 2, Rust, and the Windows WebView2 runtime. Its NSIS setup
executable installs **only for the current Windows user**, without requesting
administrator elevation. It has no all-users installation option. The installer
downloads WebView2 if the runtime is missing.

## Build

On Windows, install Node.js, Rust's stable MSVC toolchain, and Visual Studio
Build Tools with Desktop development with C++ and a Windows SDK. Then run:

```powershell
npm.cmd ci
npm.cmd test
npm.cmd run tauri:build
```

Find the installer in `src-tauri/target/release/bundle/nsis/`.
For development, run `npm.cmd run tauri:dev`.

The build prepares `src-tauri/resources/engine/` from an explicit file allowlist in `engine/`,
copies the build machine's Node executable, and installs only locked production
dependencies. End users do not need Node.js, Rust, or the source repository.
Build using a supported Node LTS release whose architecture matches the Windows
target. Preparing resources requires npm registry access. Do not commit generated
runtime files. The Node distribution's `LICENSE` is included as `NODE-LICENSE.txt`;
set `NODE_LICENSE_PATH` if it is not next to your Node executable. Production npm
packages retain their distributed license files.

## Data and installation scope

Open Bmail and choose **Set up mailbox**. Enter your email address, IMAP
server, TLS port (usually 993), and application-specific password. Saving does
not connect to your mailbox: choose **Back up now** to start, and **Install
schedule** when ready. Use **Update app password** to replace a saved password.
An existing profile keeps its mailbox identity to protect earlier backups.

Use the Sync icon beside the Account label to check the selected mailbox and
update its mail list. Hover over the icon for its label. Local progress and data
refresh automatically, so there is no separate Refresh button. Open the Backup
tab to use **Open backup folder**.

## Startup, new-mail counts, and the system tray

Bmail combines its title bar and toolbar into one draggable header with minimize, maximize/restore, and close controls. The centered envelope logo uses the existing colors and is packaged as a same-origin asset so the desktop content policy can load it.

Bmail shows a branded splash with a loading spinner while opening your local mailbox. The main window
appears when the initial dashboard is ready, including any startup error and a
retry control. Spinners also indicate mail list, mailbox check, and message preview loading. A startup deadline prevents the splash from remaining indefinitely.

Folder badges show the number of new emails found since the previous mailbox
check. The status bar keeps folder coverage and the schedule aligned to the right,
without a separate new-mail count. The Windows taskbar uses
a numeric overlay (up to `99+`); the window title and tray tooltip retain the exact
total. These are new-mail check counts, not unread counts. Switching accounts
updates the total; zero removes the badge.

By default, closing the window keeps Bmail in the Windows system tray. Click the
tray icon to reopen it, or right-click it for **Open Bmail** and **Quit Bmail**.
Change **Preferences > Window behavior > When I close Bmail** to **Quit Bmail**
if you prefer closing the window to exit. This setting applies to all accounts
on this device and survives restarts. Backups already running continue independently
when the dashboard exits.

Run `npm.cmd run test:desktop:lifecycle` to verify the native splash, account
count isolation, tray hide/restore, quit behavior, and saved preference using an
isolated profile without mailbox connections.

## Reading and appearance preferences

Preferences includes a Font selector and Font size (12-20 px). Changes apply
immediately to the interface and default email reading text and are saved on
this device. Email images can be hidden, restricted to embedded images (the
default), or expanded to include remote HTTPS images. Remote images can contact
the sender's servers. Hidden images are replaced by their alternative text.
The reading pane remains sandboxed, and scripts, forms, and unsafe image types
remain blocked in every image mode.

Common folders use dedicated icons: Inbox, Sent, Drafts, Trash, Spam, Archive,
Starred, Important, Outbox, and Templates. Provider paths such as
`[Gmail]/Sent Mail` and `INBOX.Drafts` are recognized. Custom folders keep a
standard folder icon.

## In-app notifications

The bell at the right of the navbar opens recent notifications for the selected account in a panel directly below the bell. Its
badge counts unread notifications, separately from new-email folder badges.
Use Mark all read, individual read controls, or Clear all to manage the list.
Escape closes the panel and returns focus to the bell. Up to 100 recent messages
per account are saved on this device, with a total limit of 500.

Toasts show success, information, and error icons with a dismiss button. They
pause while hovered or focused and expire automatically; dismissing a toast
keeps its message in the bell's history. New-mail discoveries and backup
completion updates also appear there. Windows desktop-alert preferences remain
in the advanced Backup options.

## Progress and backup controls

Choose **Choose what to back up** to select folders, an inclusive received-date
range, and an optional maximum number of **new** emails per run. Saved emails
are verified without using that limit. A later run continues with the next
matching emails. The newest UIDs are considered first within each folder; folder
order follows the mailbox listing. Gmail labels may overlap and produce separate
copies when you select overlapping folders.

The dashboard updates every two seconds. It shows selected messages checked,
saved this run versus the target, transferred size, current folder and email,
elapsed active time, speed, and an estimated remaining time. The estimate needs
several completed messages and can vary with attachment sizes. Counting folders
and final file verification are shown as separate phases.

- **Pause** waits for a chunk checkpoint and holds the current email in memory.
  **Resume** continues the same run. While paused the engine keeps the IMAP
  connection alive; if it drops, reconnecting reuses completed files.
- **Stop after this email** finishes and commits the current email, then stops.
- **Cancel now** closes the connection and discards an incomplete download.
  Completed email files and manifest entries are kept.

Controls are tied to a run ID, so an old request cannot stop a new backup. They
also work during reconnect waits. Closing the app does not cancel the worker;
reopen Bmail to see its current progress and controls. A backup started by an
older engine must finish or be stopped before installing the update.

### Google / Gmail

Choose **Google / Gmail** in mailbox setup. Bmail fills in
`imap.gmail.com` and TLS port `993`; this also works for Google Workspace email
addresses when the account allows app passwords and IMAP access. Enable Google
2-Step Verification and generate an app password, then paste it into Bmail.
Spaces in Google's grouped app password are removed before saving. Your normal
Google password will not work here. The help button opens Google's instructions
in your default browser.

Gmail's TLS port is fixed to `993`. An older profile saved with a different port
can be repaired by opening **Update app password** and saving again. Existing
mailbox identity and backup files are preserved. Setup failures now distinguish
configuration, folder-access, encryption, and password errors without exposing
the password or the raw PowerShell error.

This integration uses IMAP app passwords, not Google OAuth. Google may disable
app passwords for managed accounts, Advanced Protection, or some security-key
configurations. See [Google app passwords](https://support.google.com/accounts/answer/185833)
and [Gmail IMAP settings](https://developers.google.com/workspace/gmail/imap/imap-smtp).
Automated tests use dummy credentials and mailbox fixtures. Backup remains
read-only; messages under multiple Gmail labels
may be saved in more than one local folder.

The current Windows user gets a private data directory:

```text
%LOCALAPPDATA%\Bmail\
  app-settings.json
  accounts\
    your-email@gmail.com\
      backup-config.json
      .private\
      backups\messages\
      backups\manifest.json
      backups\progress.json
      logs\
      Scheduled-Backup.ps1
```

App files and the bundled engine are installed under `%LOCALAPPDATA%\Bmail`.
Use **Add account** and the mailbox selector to manage separate email accounts.
Each account has independent credentials, backup selection, progress, logs, and
messages. Finish or stop a run before changing the active account. Account folder
names use the email address; characters Windows cannot store in a filename are
percent-encoded instead of being used as path separators.
Other Windows users can install their own copy and configure their own mailbox,
encrypted credentials, and schedule. Credentials use Windows
DPAPI and cannot simply be copied to another user. Task names include the Windows
user SID to prevent users backing up the same mailbox from overwriting each
other's schedule. Tasks run while their owner is signed in, Monday at 11:00 in
Windows local time. User data is retained on uninstall unless you explicitly
select the uninstaller's option to delete application data. Remove your weekly
task in Windows Task Scheduler before uninstalling; tasks are owned by each user
and are not automatically removed by the installer.

The first Bmail launch imports the previous installed profile into
`Bmail\accounts\<email>`. It moves only business data, preserving email bytes and
DPAPI-encrypted credential files. It keeps the old browser cache in place and
refuses to overwrite conflicting files. An interrupted migration can be retried.
An existing weekly task is updated to the new account folder when possible;
otherwise Bmail displays an instruction to update the schedule.

Install and open Bmail before removing the old application. Verify the imported
mail first and keep application data when uninstalling the old application.
Existing source-folder backups are not migrated automatically. Copy your config
and backups into an account folder with the app closed, then configure a fresh
credential as that Windows user. Remove the old task only after checking the new
schedule. Standalone scripts still default to storing data next to the scripts.

## Release verification

For changes to mailbox setup or Windows process invocation, run:

```powershell
npm.cmd run test:desktop:setup
npm.cmd run tauri:build
```

The first command builds a separate test app identifier and exercises the actual
native dialog, Rust IPC, windowless PowerShell, and DPAPI using a dummy grouped
Gmail app password. Its temporary data and browser profile are isolated from your
real mailbox and removed afterwards. It requires WebView2 and uses Playwright Core
through the local debugging endpoint; no separate browser download is needed.
Rebuild the normal installer afterwards to restore the production app identifier.

Local checks on 2026-11-15: all twelve automated engine/installer tests and four
profile migration tests passed; the frontend and
Windows x64 Tauri/NSIS installer built successfully. The app extracted from the
installer launched outside the repository, served its dashboard through Rust
IPC, resolved engine resources, and opened mailbox setup. The extracted bundled
Node runtime verified a fixture with Node removed from `PATH`. Browser checks
covered Gmail presets, provider switching, setup errors, retry, save, password
clearing, scope selection, live progress, run controls, and isolated account data.
The current-user setup executable's embedded manifest was checked for
`asInvoker`, confirming it does not request administrator elevation. Packaged
Gmail setup also saved an encrypted test profile using only bundled scripts.
Version 0.1.1 fixes a native-only setup failure: Tauri's verbatim Windows resource
path (`\\?\C:\...`) reached PowerShell's provider-based path operations, which
rejected it before the password was read. Windows paths are now simplified before
being passed to PowerShell. The full native setup test confirms a grouped app
password can be saved from the actual form and appears ready on the dashboard.
Actual installation, upgrade, and uninstall as a standard Windows user still
require the clean-VM checks below before a public release.

Test the setup executable on a clean Windows VM with no Node installation:

- Install for the current user as a standard user; complete setup, back up,
  verify, and run the scheduled task.
- Confirm there is no all-users option or administrator-elevation prompt.
- Upgrade and uninstall the current-user installation; confirm user data is
  retained unless explicitly selected for deletion.
- Test a machine without WebView2 and check the runtime bootstrapper.

The new installer does not remove machine-wide installations or migrate another
Windows user's data. Keep application data if you remove an earlier installation.

The project does not configure code signing. Configure a Windows code-signing
certificate for public distribution. Never treat an untested installer build as
a verified release.

## Git workflow

Start features from `dev`, commit each feature, and merge it into `dev`. Release
only after the checks above: merge `dev` into `main`, tag the version, and push
`main` and the tag to your configured remote. A remote must be configured first.
