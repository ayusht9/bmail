const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

if (process.platform !== 'win32') throw new Error('Build the Windows installer on Windows.');
const root = path.resolve(__dirname, '..');
const target = process.env.TAURI_ENV_TARGET_TRIPLE;
if (target && !target.startsWith(`${process.arch === 'x64' ? 'x86_64' : process.arch === 'arm64' ? 'aarch64' : 'i686'}-`)) {
  throw new Error('Use a Node runtime matching the Windows build architecture.');
}
const output = path.join(root, 'src-tauri/resources/engine');
fs.mkdirSync(output, { recursive: true });
// Explicit allowlist: never package credentials, backups, logs, or local config.
for (const file of [
  'mail-index.cjs', 'paths.cjs', 'Data-Directory.ps1', 'read-mail.cjs', 'backup.cjs', 'backup-history.cjs', 'Notify-Backup.ps1', 'backup-stats.cjs', 'backup-progress.cjs', 'backup-selection.cjs', 'backup-control.cjs', 'Run-Backup.ps1', 'Invoke-BackupProcess.ps1', 'Backup-Paths.ps1',
  'Install-BackupSchedule.ps1', 'Backup-Schedule.ps1', 'Manage-BackupSchedule.ps1', 'Setup-Backup.ps1', 'Protect-CredentialDirectory.ps1',
  'Save-Mailbox.ps1',
  'backup-config.example.json',
]) fs.copyFileSync(path.join(root, 'engine', file), path.join(output, file));
for (const file of ['LICENSE', 'package.json', 'package-lock.json']) {
  fs.copyFileSync(path.join(root, file), path.join(output, file));
}
fs.copyFileSync(process.execPath, path.join(output, 'node.exe'));
const nodeLicense = process.env.NODE_LICENSE_PATH || path.join(path.dirname(process.execPath), 'LICENSE');
if (!fs.existsSync(nodeLicense)) throw new Error('Set NODE_LICENSE_PATH to the LICENSE file from your Node.js distribution.');
fs.copyFileSync(nodeLicense, path.join(output, 'NODE-LICENSE.txt'));
// npm ci installs only the locked production dependency tree in the resource folder.
execFileSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm.cmd ci --omit=dev --ignore-scripts --no-audit --no-fund'], {
  cwd: output, stdio: 'inherit', windowsHide: true,
});
console.log(`Prepared Windows ${process.arch} backup runtime (${process.version}).`);
