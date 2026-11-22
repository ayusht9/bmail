# Branching strategy for all projects

- `main`: permanent, stable production branch.
- `dev`: permanent development and integration branch.
- `feature/*`: temporary branches for individual features.
- `bugfix/*`: temporary branches for individual bug fixes.
- `hotfix/*`: temporary branches for urgent production fixes.
- Do not maintain a permanent `bugfix` branch.

## Merge strategy

- Squash merge feature and bugfix branches into `dev`; each completed feature or bug fix must appear as one meaningful commit.
- Avoid unnecessary merge commits such as `Merge feature XYZ into dev`.
- Delete temporary branches after successful merging.
- Update `main` only through tested releases or urgent production hotfixes.
- Incorporate production hotfixes into `dev` as well.
- Prefer conventional commit messages: `feat:`, `fix:`, `refactor:`, and `chore:`.
- Apply this strategy going forward. Do not rewrite existing history, rebase published history, or force-push to retrofit it.

## Expected workflow

1. Create a temporary branch from the latest `dev`.
2. Implement changes and commit normally.
3. Test and validate the implementation.
4. Squash merge the completed feature or bug fix into `dev` with a meaningful conventional commit message.
5. Push `dev` and delete the temporary branch after successful merging.
6. Promote tested changes from `dev` to `main` when releasing.

# Repository validation and data safety

- Never commit credentials, personal configuration, email backups, logs, or
  generated runtime resources.
- Run `npm.cmd test` and `npm.cmd run build` for applicable changes. For Windows
  packaging changes, also build the Tauri installer when prerequisites permit.

# Beta versions and builds

- Keep the major version at `0` during beta.
- Increment the patch number for bug fixes (for example, `0.4.0` to `0.4.1`). Increment the middle number for minor releases.
- Keep the Tauri and Cargo package/lock versions in sync.
- Do not generate the app or installer until the user requests it. Source validation and tests may run independently.
