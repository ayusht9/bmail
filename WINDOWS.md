# Mail Vault for Windows

Mail Vault uses Tauri 2, Rust, and the Windows WebView2 runtime. Its NSIS setup
executable offers **Only for me** and **Anyone who uses this computer**.
Installing for all users requires administrator approval; normal app use does
not. The installer downloads WebView2 if the runtime is missing.

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
runtime files. Review dependency and Node licenses before distributing releases.

## Data and installation scope

Open Mail Vault and choose **Set up mailbox**. Enter your email address, IMAP
server, TLS port (usually 993), and application-specific password. Saving does
not connect to your mailbox: choose **Back up now** to start, and **Install
schedule** when ready. Use **Update app password** to replace a saved password.
An existing profile keeps its mailbox identity to protect earlier backups.

In either install mode, each signed-in Windows user gets a separate directory:

```text
%LOCALAPPDATA%\in.co.integramicro.mail-vault\
  backup-config.json
  .private\zoho-credential.xml
  backups\
  logs\
  Scheduled-Backup.ps1
```

App files and the bundled engine stay in the install directory. All-user
installation makes the app available to every Windows user; each user configures
their own mailbox, encrypted credentials, and schedule. Credentials use Windows
DPAPI and cannot simply be copied to another user. Task names include the Windows
user SID to prevent users backing up the same mailbox from overwriting each
other's schedule. Tasks run while their owner is signed in, Monday at 11:00 in
Windows local time. User data is retained when the app is uninstalled.

Existing source-folder backups are not migrated automatically. Copy your config
and backups into the profile folder with the app closed, then configure a fresh
credential as that Windows user. Remove the old task only after checking the new
schedule. Standalone scripts still default to storing data next to the scripts.

## Release verification

Test the setup executable on a clean Windows VM with no Node installation:

- Install for the current user as a standard user; complete setup, back up,
  verify, and run the scheduled task.
- Install for all users with administrator approval, then launch as two standard
  users and check that config, credentials, tasks, and backups remain separate.
- Upgrade and uninstall both install modes; confirm user data is retained.
- Test a machine without WebView2 and check the runtime bootstrapper.

The project does not configure code signing. Configure a Windows code-signing
certificate for public distribution. Never treat an untested installer build as
a verified release.

## Git workflow

Start features from `dev`, commit each feature, and merge it into `dev`. Release
only after the checks above: merge `dev` into `main`, tag the version, and push
`main` and the tag to your configured remote. A remote must be configured first.
