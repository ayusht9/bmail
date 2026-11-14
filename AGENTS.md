# Repository workflow

- Create every new feature on a separate `feature/<name>` branch from `dev`.
- Commit each completed feature, then merge it into `dev` with a merge commit.
- Keep `main` for releases. After release verification, merge `dev` into `main`
  and push `main` to the configured remote when releasing.
- Never commit credentials, personal configuration, email backups, logs, or
  generated runtime resources.
- Run `npm.cmd test` and `npm.cmd run build` for applicable changes. For Windows
  packaging changes, also build the Tauri installer when prerequisites permit.
