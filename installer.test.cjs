const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { digest } = require('./backup.cjs');

test('installed engine verifies user data when launched from a different directory', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mail-vault-installed-'));
  try {
    const data = path.join(root, 'User profile with spaces');
    const backups = path.join(data, 'mail');
    fs.mkdirSync(backups, { recursive: true });
    const bytes = Buffer.from('Subject: Installed app\r\n\r\nSaved mail');
    fs.writeFileSync(path.join(backups, 'message.eml'), bytes);
    fs.writeFileSync(path.join(data, 'backup-config.json'), JSON.stringify({ backupDirectory: 'mail' }));
    fs.writeFileSync(path.join(backups, 'manifest.json'), JSON.stringify({ folders: { inbox: { messages: {
      1: { file: 'message.eml', bytes: bytes.length, sha256: digest(bytes) },
    } } } }));
    const options = { cwd: root, env: { ...process.env, MAIL_VAULT_DATA_DIR: data }, encoding: 'utf8' };
    const good = spawnSync(process.execPath, [path.resolve('backup.cjs'), '--verify'], options);
    assert.equal(good.status, 0, good.stderr);
    assert.equal(JSON.parse(good.stdout).checked, 1);
    fs.writeFileSync(path.join(backups, 'message.eml'), 'damaged');
    const bad = spawnSync(process.execPath, [path.resolve('backup.cjs'), '--verify'], options);
    assert.equal(bad.status, 1);
    assert.equal(JSON.parse(bad.stdout).invalid.length, 1);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
