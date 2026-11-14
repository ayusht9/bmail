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

test('Gmail setup saves the IMAP preset and normalizes a grouped Google app password', { skip: process.platform !== 'win32' }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mail-vault-gmail-'));
  const env = { ...process.env, MAIL_VAULT_DATA_DIR: root };
  try {
    const saved = spawnSync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.resolve('Save-Mailbox.ps1'),
    ], { env, encoding: 'utf8', windowsHide: true, input: JSON.stringify({
      user: 'fixture@gmail.com', host: 'imap.gmail.com', port: 993, password: 'abcd efgh ijkl mnop',
    }) });
    assert.equal(saved.status, 0, saved.stderr);
    const config = JSON.parse(fs.readFileSync(path.join(root, 'backup-config.json'), 'utf8').replace(/^\uFEFF/, ''));
    assert.equal(config.host, 'imap.gmail.com');
    assert.equal(config.port, 993);
    assert.equal(config.user, 'fixture@gmail.com');
    assert.ok(!JSON.stringify(config).includes('password'));
    const checked = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      "$c = Import-Clixml -LiteralPath (Join-Path $env:MAIL_VAULT_DATA_DIR '.private/zoho-credential.xml'); if ($c.UserName -ne 'fixture@gmail.com' -or $c.GetNetworkCredential().Password -cne 'abcdefghijklmnop') { exit 1 }",
    ], { env, encoding: 'utf8', windowsHide: true });
    assert.equal(checked.status, 0, checked.stderr);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('mailbox setup encrypts the password and rejects mailbox identity changes', { skip: process.platform !== 'win32' }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mail-vault-setup-'));
  const secret = 'test-only-app-password-9381';
  const settings = { user: 'test@example.com', host: 'imap.example.com', port: 993, password: secret };
  const options = { env: { ...process.env, MAIL_VAULT_DATA_DIR: root }, encoding: 'utf8', timeout: 30000 };
  const save = request => spawnSync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.resolve('Save-Mailbox.ps1'),
  ], { ...options, input: JSON.stringify(request) });
  try {
    const result = save(settings);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(!result.stdout.includes(secret));
    assert.ok(!result.stderr.includes(secret));
    const configPath = path.join(root, 'backup-config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, ''));
    assert.equal(config.user, settings.user);
    assert.equal(config.backupDirectory, 'backups');
    const credentialPath = path.join(root, '.private/zoho-credential.xml');
    assert.ok(!fs.readFileSync(credentialPath, 'utf8').includes(secret));
    const decrypted = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      "$c = Import-Clixml -LiteralPath (Join-Path $env:MAIL_VAULT_DATA_DIR '.private/zoho-credential.xml'); if ($c.UserName -ne 'test@example.com' -or $c.GetNetworkCredential().Password -ne 'test-only-app-password-9381') { exit 1 }",
    ], options);
    assert.equal(decrypted.status, 0, decrypted.stderr);
    const before = fs.readFileSync(credentialPath);
    assert.equal(save({ ...settings, user: 'other@example.com' }).status, 1);
    assert.deepEqual(fs.readFileSync(credentialPath), before);
    assert.equal(save({ ...settings, password: '' }).status, 1);
    assert.equal(save({ ...settings, password: 'updated-test-password' }).status, 0);
    assert.notDeepEqual(fs.readFileSync(credentialPath), before);
    assert.deepEqual(JSON.parse(fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, '')), config);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
