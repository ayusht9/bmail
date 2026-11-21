const fs = require('node:fs');
const path = require('node:path');

// Share one allowlist between installer preparation and local development.
// Personal configuration, credentials, mail and logs never enter the runtime.
const runtimeSources = [
  'cloud-icloud.cjs', 'icloud-messages.json', 'Select-ICloudFolder.ps1',
  'cloud-dropbox.cjs', 'dropbox-client.cjs', 'dropbox-messages.json',
  'cloud-drive.cjs', 'drive-client.cjs', 'drive-messages.json', 'Drive-Credentials.ps1',
  'mail-watch.cjs', 'mail-metadata.cjs', 'mail-page.cjs', 'mail-index.cjs', 'paths.cjs', 'Data-Directory.ps1', 'read-mail.cjs', 'backup.cjs', 'backup-history.cjs', 'Notify-Backup.ps1', 'backup-stats.cjs', 'backup-progress.cjs', 'backup-selection.cjs', 'backup-control.cjs', 'Run-Backup.ps1', 'Invoke-BackupProcess.ps1', 'Backup-Paths.ps1',
  'Install-BackupSchedule.ps1', 'Backup-Schedule.ps1', 'Manage-BackupSchedule.ps1', 'Setup-Backup.ps1', 'Protect-CredentialDirectory.ps1',
  'Save-Mailbox.ps1', 'Outlook-Auth.ps1', 'Start-OutlookSignIn.ps1', 'backup-config.example.json',
];

function syncRuntimeSources(root, output = path.join(root, 'src-tauri/resources/engine')) {
  fs.mkdirSync(output, { recursive: true });
  let changed = 0;
  for (const name of runtimeSources) {
    const source = fs.readFileSync(path.join(root, 'engine', name));
    const target = path.join(output, name);
    if (fs.existsSync(target) && source.equals(fs.readFileSync(target))) continue;
    fs.writeFileSync(target, source); changed++;
  }
  return changed;
}

module.exports = { runtimeSources, syncRuntimeSources };
