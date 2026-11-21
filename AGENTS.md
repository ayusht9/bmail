# Repository workflow

- Keep `main` permanent for stable, production-ready releases and `dev` permanent
  for integration and testing (`develop` is the default name in new projects).
- Create each feature on a temporary `feature/<name>` branch from `dev`.
- Fix bugs on a temporary `bugfix/<name>` branch from `dev`, keeping related fixes together.
- Commit completed work. Once related bugs are fixed and verified, merge the bugfix
  branch into `dev` with a merge commit immediately. Merge completed, verified
  feature branches into `dev` with a merge commit too.
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
