# Mail Vault for Windows

Mail Vault uses Tauri 2, Rust, and the Windows WebView2 runtime. Its NSIS setup
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

The build prepares `src-tauri/resources/engine/` from an explicit file allowlist,
copies the build machine's Node executable, and installs only locked production
dependencies. End users do not need Node.js, Rust, or the source repository.
Build using a supported Node LTS release whose architecture matches the Windows
target. Preparing resources requires npm registry access. Do not commit generated
runtime files. The Node distribution's `LICENSE` is included as `NODE-LICENSE.txt`;
set `NODE_LICENSE_PATH` if it is not next to your Node executable. Production npm
packages retain their distributed license files.

## Data and installation scope

Open Mail Vault and choose **Set up mailbox**. Enter your email address, IMAP
server, TLS port (usually 993), and application-specific password. Saving does
not connect to your mailbox: choose **Back up now** to start, and **Install
schedule** when ready. Use **Update app password** to replace a saved password.
An existing profile keeps its mailbox identity to protect earlier backups.

### Google / Gmail

Choose **Google / Gmail** in mailbox setup. Mail Vault fills in
`imap.gmail.com` and TLS port `993`; this also works for Google Workspace email
addresses when the account allows app passwords and IMAP access. Enable Google
2-Step Verification and generate an app password, then paste it into Mail Vault.
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
Live Gmail authentication requires your own account and has not been tested with
real credentials. Backup remains read-only; messages under multiple Gmail labels
may be saved in more than one local folder.

The current Windows user gets a private data directory:

```text
%LOCALAPPDATA%\in.co.integramicro.mail-vault\
  backup-config.json
  .private\zoho-credential.xml
  backups\
  logs\
  Scheduled-Backup.ps1
```

App files and the bundled engine are installed under `%LOCALAPPDATA%\Mail Vault`.
Other Windows users can install their own copy and configure their own mailbox,
encrypted credentials, and schedule. Credentials use Windows
DPAPI and cannot simply be copied to another user. Task names include the Windows
user SID to prevent users backing up the same mailbox from overwriting each
other's schedule. Tasks run while their owner is signed in, Monday at 11:00 in
Windows local time. User data is retained on uninstall unless you explicitly
select the uninstaller's option to delete application data. Remove your weekly
task in Windows Task Scheduler before uninstalling; tasks are owned by each user
and are not automatically removed by the installer.

Existing source-folder backups are not migrated automatically. Copy your config
and backups into the profile folder with the app closed, then configure a fresh
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

Local checks on 2026-11-15: all six automated tests passed; the frontend and
Windows x64 Tauri/NSIS installer built successfully. The app extracted from the
installer launched outside the repository, served its dashboard through Rust
IPC, resolved engine resources, and opened mailbox setup. The extracted bundled
Node runtime verified a fixture with Node removed from `PATH`. Browser checks
covered Gmail presets, provider switching, setup errors, retry, save, password
clearing, cancel, and backup feedback.
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

If you previously installed an all-users build, uninstall that copy using its
original uninstaller before installing this current-user build. Keep application
data when uninstalling if you want to retain backups. The new installer does not
remove machine-wide installations or migrate another Windows user's data.

The project does not configure code signing. Configure a Windows code-signing
certificate for public distribution. Never treat an untested installer build as
a verified release.

## Git workflow

Start features from `dev`, commit each feature, and merge it into `dev`. Release
only after the checks above: merge `dev` into `main`, tag the version, and push
`main` and the tag to your configured remote. A remote must be configured first.
