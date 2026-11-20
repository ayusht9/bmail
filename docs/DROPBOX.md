# Dropbox cloud backup

Public Bmail builds use one registered Dropbox application. Users click
**Preferences → Dropbox backup → Connect Dropbox**, sign in through their normal
browser, and approve access. They do not register an app or import client JSON.

## App registration and build configuration

In the [Dropbox App Console](https://www.dropbox.com/developers/apps):

1. Create a **Scoped access → App folder** application, with a unique Bmail name.
2. Enable `account_info.read`, `files.metadata.read`, and `files.content.write`.
3. Add this exact OAuth redirect URI:

   ```text
   http://127.0.0.1:53683/oauth/dropbox/callback
   ```

4. Enable **Allow public clients** if the console shows that option. Bmail uses
   authorization-code OAuth with S256 PKCE and offline refresh tokens. It neither
   needs nor ships the app secret.
5. For local builds, put the public app key in the ignored root `.env.local`:

   ```dotenv
   BMAIL_DROPBOX_APP_KEY=your_registered_app_key
   ```

   The Rust build script reads this file, or uses the environment variable of the
   same name if supplied. The key identifies the public desktop client; it is not
   a user's access token. Repository policy keeps registration configuration out
   of source control even though the identifier is included in the compiled app.
6. For GitHub Actions, add repository Actions secret `BMAIL_DROPBOX_APP_KEY`.
   The manual installer workflow passes it into the build. No credential or
   token values belong in workflow files, source files, or release notes.

The callback server binds only to `127.0.0.1` and port `53683`, validates a random
state, and closes on success, denial, or the three-minute timeout. A second login
cannot take over a port already used by a first login. The fixed URI is needed
because Dropbox matches redirects against the registered app configuration.

## Public distribution

Development registration is separate from production approval. Initially the app
can connect its owner's Dropbox account. Enable additional development users in
the console for testing. Dropbox documents a development limit of 500 linked
users and requires an application for production approval within two weeks of
reaching 50 linked users, before additional account linking is frozen. Review
the current rules in Dropbox's developer guide before a public launch.

Complete app branding, website/support details, and a public privacy policy in
the Dropbox console. Test a real owner sign-in and a small backup, then obtain
the applicable production approval before broad distribution. Registration by
itself does not mean Dropbox has approved the app for production.

## Backup behavior

Connections and automatic upload settings are independent for every mailbox and
every cloud provider. Users can enable Dropbox, Google Drive, or both. Successful
local and scheduled backups, including individual-message backups, trigger opted-in
providers. Cloud failures never change local backup success. If a Dropbox upload
already runs when another local backup completes, another pass is queued to copy
the latest manifest.

Inside the application's Dropbox folder, Bmail creates a mailbox directory named
`Bmail - <mailbox>--<identity suffix>`, preserving relative email folders and names.
Only verified, complete manifest-listed `.eml` files and `manifest.json` are sent.
Credentials, settings, logs, caches, and partial downloads are excluded. The
manifest is published last. Different mail hosts with the same mailbox address
use separate identity suffixes.

Uploads use sessions in bounded chunks, recover the server offset after a lost
response, verify Dropbox's 4 MiB block-based content hash, and skip unchanged
files. Upload commits use revision checks without autorename, so a retry does
not create duplicate files or silently overwrite a file changed mid-upload.
An interrupted file may restart after an app restart; completed files are skipped.

Dropbox tokens are stored with Windows DPAPI in the mailbox's owner-only
`.private/dropbox.dat`, separately from Google credentials. Disconnect deletes
this local token file and disables automatic Dropbox uploads. It leaves both
local and remote email copies intact. To revoke the entire app grant, remove
Bmail in Dropbox's connected-app settings; that can affect other mailboxes using
the same Dropbox application and account.

Users supply their own Dropbox storage allowance. This is one-way backup, not a
restore wizard or two-way sync. Download the entire mailbox archive to recover
the original relative file layout and manifest. Bmail does not add client-side
archive encryption to the uploaded email files.

## Validation

The Vite development server refreshes the allowlisted bundled engine sources at
startup and after engine source edits. If the desktop backend was rebuilt outside
the normal Tauri development command, run
`npm.cmd run prepare:runtime -- --sources-only` to repair a stale runtime without
replacing a Node executable already in use. New production dependencies still
require a full runtime preparation.

Run `npm.cmd test`, `npm.cmd run build`, and
`cargo check --manifest-path src-tauri/Cargo.toml --lib`. Tests exercise PKCE,
callback state/denial/timeouts, interrupted uploads, content hashes, quota and
permission failures, credential isolation, and UI navigation. These source
checks do not generate the desktop app or installer.

References: [Dropbox OAuth](https://docs.dropboxapi.com/dropbox-api/docs/oauth),
[content hash](https://www.dropbox.com/developers/reference/content-hash),
[production approval](https://www.dropbox.com/developers/reference/developer-guide).
