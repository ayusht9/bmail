# Repository workflow

- Create every new feature on a separate `feature/<name>` branch from `dev`.
- Commit each completed feature, then merge it into `dev` with a merge commit.
- Keep `main` for releases. After release verification, merge `dev` into `main`
  and push `main` to the configured remote when releasing.
- Never commit credentials, personal configuration, email backups, logs, or
  generated runtime resources.
- Run `npm.cmd test` and `npm.cmd run build` for applicable changes. For Windows
  packaging changes, also build the Tauri installer when prerequisites permit.

# Beta versions and builds

- Keep the major version at `0` during beta.
- Increment the patch number for bug fixes (for example, `0.4.0` to `0.4.1`). Increment the middle number for minor releases.
- Keep the Tauri and Cargo package/lock versions in sync.
- Do not generate the app or installer until the user requests it. Source validation and tests may run independently.
