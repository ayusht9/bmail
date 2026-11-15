# Signed updates

Bmail checks GitHub Releases on startup and offers **Install and restart** when
a newer version exists. Checks never install automatically. Release notes are
rendered as plain text. The Rust backend downloads and verifies the Tauri
signature before running the current-user NSIS installer. The signed version
must also match the version advertised by the update feed. It checks all account
profiles for active backups before download and again before installation.
Dashboard backup launches are blocked during an update. Avoid scheduled backup
times when installing: Windows Task Scheduler runs independently of the app.
Backups and encrypted credentials remain in the separate local data directory.

The endpoint is `https://github.com/ayusht9/bmail/releases/latest/download/latest.json`.
A missing release or network failure appears in the update panel and can be retried.
This first updater-enabled build must be installed manually; older builds cannot
gain an updater until upgraded.

## Signing key

The public key is committed in `src-tauri/tauri.conf.json`. The private key is
stored outside this repository at `$HOME\.tauri\bmail-updater.key` on the
development machine. Back it up securely: losing it prevents future updates to
installed copies. Never commit a private key. Tauri updater signing is separate
from Windows Authenticode signing.

Set the GitHub Actions secret `TAURI_SIGNING_PRIVATE_KEY` to the **contents** of
that private key. Set `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` if the key has a password.
Only the public key belongs in source control.

## Build and publish

1. Update the version in both `src-tauri/tauri.conf.json` and
   `src-tauri/Cargo.toml`; refresh Cargo.lock. Use a stable `major.minor.patch`.
2. Run `npm.cmd test`, `npm.cmd run build`, and verify the Windows installer.
3. Follow AGENTS.md to merge the verified release into `main`, then push `main`
   and a matching `v<version>` tag. The Actions workflow requires a tag on main.
4. Actions builds a signed installer and creates a **draft** GitHub release with
   the installer, `.sig`, and `latest.json`. Test install, upgrade, signature
   rejection, offline retry, active-backup blocking, and preservation of accounts,
   encrypted credentials, schedules, and mail on a clean Windows VM.
5. Publish the verified draft as the latest stable release. Installed clients
   will then discover it. Do not replace assets of an existing release.

For a local signed build, set `TAURI_SIGNING_PRIVATE_KEY` to the private key path
in PowerShell and run `npm.cmd run release:build`. Artifacts are written under
the ignored `.tools/ota-release/` directory. Optional `BMAIL_RELEASE_NOTES` sets
the manifest notes. Ordinary `npm.cmd run tauri:build` remains available without
access to the signing key; only `release:build` enables updater artifacts.

`npm.cmd run test:updates:ui` tests the built dashboard with a simulated IPC
connection. After a signed local build, `npm.cmd run test:desktop:updates` builds
an isolated native test app and exercises a loopback update feed, blocking an
active backup in a second account, rejecting a tampered installer, and recovering
when the feed reports no update. Its temporary app data folder is separate from
Bmail's data. It does not execute an installer. Rebuild the normal installer
afterwards to restore the production executable and HTTPS configuration.

An unsigned manifest cannot bypass installer signature verification. A correctly
signed installer still needs full upgrade testing before publication. No public
release is automatically published by the build workflow.
