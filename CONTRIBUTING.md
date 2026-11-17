# Working on Bmail

Start feature branches from `dev` using `feature/<name>`. Commit completed work
and merge it back to `dev` with a merge commit. Reserve `main` for releases.
See [AGENTS.md](AGENTS.md) for repository workflow requirements.

## Code map

```text
engine/      Backup runtime, Windows helpers, and example configuration
src/         Desktop frontend
src-tauri/   Native desktop app and installer configuration
scripts/     Build and verification utilities
tests/       Automated Node.js tests
docs/        Setup and feature guides
```

| Area | Entry points and responsibilities |
| --- | --- |
| Desktop UI | `src/main.js` coordinates application state, Tauri calls, rendering, and events. |
| Desktop integration | `src/preferences.js` renders desktop settings. Native `desktop.rs`, `notifications.rs`, and `startup.rs` own tray behavior, taskbar counts, and splash readiness. |
| Navigation | `src/navigation.js` owns bounded back/forward history and saved folder filters; `src/workspace.js` renders tabs. |
| Mail views | `src/desktop.js` renders folders and saved mail; `src/reader.js` sanitizes and renders message content. |
| Backup UI | `src/selection.js`, `src/progress.js`, and `src/history.js` handle backup options, progress, and activity views. |
| Scheduling | `src/scheduler.js` handles schedule normalization, previews, and form data. |
| UI infrastructure | `src/polling.js`, `src/panes.js`, `src/columns.js`, and `src/theme.js` handle refresh timing, resizing, and appearance. |
| Native app | `src-tauri/src/lib.rs` exposes Tauri commands and coordinates desktop processes. Sibling modules handle profiles, cache, mail, and exports. |
| Backup engine | `engine/backup.cjs` runs the Node.js engine. Sibling modules handle selection, controls, progress, history, statistics, and data paths. |
| Windows integration | PowerShell scripts in `engine/` handle setup, credentials, scheduled tasks, and backup launch. `scripts/` contains build and verification utilities. |

## Refactoring and validation

Keep state transitions separate from DOM updates and native calls where practical.
Pass the data a helper needs explicitly; keep application orchestration in the
entry point. Preserve account isolation, interrupted-run recovery, and message
sanitization when moving code.

Run `npm.cmd test` and `npm.cmd run build` before merging. The test command runs
Node's test runner against `tests/*.test.cjs`; put new tests in that folder.
Navigation tests run without a browser or Tauri runtime.
For native and packaging prerequisites, see [WINDOWS.md](docs/WINDOWS.md).

Do not commit credentials, personal configuration, email backups, logs, or
generated runtime resources.

Standalone commands run from the repository root, for example
`node engine/backup.cjs --verify`. Existing standalone data remains at the
repository root; `MAIL_VAULT_DATA_DIR` overrides it. Packaging copies the explicit
runtime allowlist from `engine/` into `src-tauri/resources/engine/`, keeping the
installed layout unchanged.
