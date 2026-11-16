const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { digest } = require('./backup.cjs');

test('Stats and NewMail modes launch Node through the real PowerShell helper and preserves diagnostics', { skip: process.platform !== 'win32' }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bmail-stats-launch-'));
  const engine = path.join(root, 'Engine with spaces');
  const data = path.join(root, 'Account data');
  fs.mkdirSync(engine); fs.mkdirSync(data);
  const env = { ...process.env, MAIL_VAULT_DATA_DIR: data };
  const secret = 'fixture-only-password';
  try {
    for (const file of ['Run-Backup.ps1', 'Invoke-BackupProcess.ps1', 'Backup-Paths.ps1']) fs.copyFileSync(path.resolve(file), path.join(engine, file));
    const saved = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.resolve('Save-Mailbox.ps1')],
      { env, encoding: 'utf8', windowsHide: true, input: JSON.stringify({ user: 'fixture@example.com', host: 'imap.example.com', port: 993, password: secret }) });
    assert.equal(saved.status, 0, saved.stderr || saved.stdout);
    fs.writeFileSync(path.join(engine, 'backup.cjs'), `
      (async () => {
        let input = ''; for await (const chunk of process.stdin) input += chunk;
        const credentials = JSON.parse(input.replace(/^\\uFEFF/, ''));
        if (process.argv[2] !== (process.env.EXPECT_NEW_MAIL ? '--new-mail' : '--check-mailbox') || credentials.user !== 'fixture@example.com' || !credentials.password) process.exit(9);
        if (process.env.STATS_TEST_FAIL) { console.error('Fixture mailbox connection failed'); process.exit(7); }
        console.log('Mailbox checked through native launcher');
      })();
    `);
    const run = (extra, mode = 'Stats') => spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(engine, 'Run-Backup.ps1'), '-Mode', mode],
      { env: { ...env, ...extra }, encoding: 'utf8', windowsHide: true, timeout: 30000 });
    const checked = run({});
    assert.equal(checked.status, 0, checked.stderr || checked.stdout);
    assert.match(checked.stdout, /Mailbox checked through native launcher/);
    const newMail = run({ EXPECT_NEW_MAIL: '1' }, 'NewMail');
    assert.equal(newMail.status, 0, newMail.stderr || newMail.stdout);
    assert.match(newMail.stdout, /Mailbox checked through native launcher/);
    const failed = run({ STATS_TEST_FAIL: '1' });
    assert.equal(failed.status, 7, failed.stderr || failed.stdout);
    assert.match(failed.stdout, /Fixture mailbox connection failed/);
    assert.ok(![checked.stdout, checked.stderr, newMail.stdout, newMail.stderr, failed.stdout, failed.stderr].join('').includes(secret));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

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

test('Gmail rejects SMTP port 25 and repairs a saved wrong port without changing backups', { skip: process.platform !== 'win32' }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mail-vault-gmail-repair-'));
  const secret = 'abcd efgh ijkl mnop';
  const settings = { user: 'fixture@gmail.com', host: 'imap.gmail.com', port: 993, password: secret };
  const save = request => spawnSync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.resolve('Save-Mailbox.ps1'),
  ], { env: { ...process.env, MAIL_VAULT_DATA_DIR: root }, encoding: 'utf8', windowsHide: true, input: JSON.stringify(request) });
  try {
    const wrong = save({ ...settings, port: 25 });
    assert.equal(wrong.status, 1);
    assert.equal(JSON.parse(wrong.stdout).errorCode, 'GMAIL_REQUIRES_993');
    assert.equal(fs.existsSync(path.join(root, '.private')), false);
    assert.equal(fs.existsSync(path.join(root, 'backup-config.json')), false);
    fs.mkdirSync(path.join(root, 'my-mail'));
    fs.writeFileSync(path.join(root, 'my-mail/preserved.eml'), 'Existing backup');
    fs.writeFileSync(path.join(root, 'backup-config.json'), JSON.stringify({
      user: settings.user, host: settings.host, port: 25, backupDirectory: 'my-mail',
    }));
    const repaired = save(settings);
    assert.equal(repaired.status, 0, repaired.stderr || repaired.stdout);
    const config = JSON.parse(fs.readFileSync(path.join(root, 'backup-config.json'), 'utf8').replace(/^\uFEFF/, ''));
    assert.equal(config.port, 993);
    assert.equal(config.backupDirectory, 'my-mail');
    assert.equal(fs.readFileSync(path.join(root, 'my-mail/preserved.eml'), 'utf8'), 'Existing backup');
    assert.ok(!repaired.stdout.includes(secret));
    fs.writeFileSync(path.join(root, 'backup-config.json'), '{bad config');
    const corrupt = save(settings);
    assert.equal(corrupt.status, 1);
    assert.equal(JSON.parse(corrupt.stdout).errorCode, 'CONFIG_UNREADABLE');
    assert.ok(!corrupt.stdout.includes(secret));
    assert.ok(!corrupt.stderr.includes(secret));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});


test('new-mail checks report a busy mailbox lock before connecting to the server', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bmail-new-mail-busy-'));
  try {
    fs.mkdirSync(path.join(root, 'backups'));
    fs.writeFileSync(path.join(root, 'backup-config.json'), JSON.stringify({ user: 'fixture@example.com', host: 'imap.example.com', port: 993, backupDirectory: 'backups' }));
    fs.writeFileSync(path.join(root, 'backups', '.backup.lock'), JSON.stringify({ pid: process.pid }));
    const result = spawnSync(process.execPath, [path.resolve('backup.cjs'), '--new-mail'], {
      env: { ...process.env, MAIL_VAULT_DATA_DIR: root }, encoding: 'utf8', input: JSON.stringify({ user: 'fixture@example.com', password: 'fixture-test-secret' }), timeout: 10000,
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /BACKUP_BUSY/);
    assert.doesNotMatch(result.stderr + result.stdout, /fixture-test-secret/);
    assert.equal(fs.existsSync(path.join(root, 'backups', '.backup.lock')), true, 'The other process retains its lock');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});


test('email reader decodes multipart saved mail and rejects unsaved or external paths', async () => {
  const { readSavedMail } = require('./read-mail.cjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bmail-reader-'));
  const outside = root + '.eml';
  try {
    const source = 'From: =?UTF-8?B?U2VuZGVy?= <sender@example.com>\r\nTo: reader@example.com\r\nSubject: =?UTF-8?B?SGVsbG8gw6k=?=\r\nMIME-Version: 1.0\r\nContent-Type: multipart/alternative; boundary="parts"\r\n\r\n--parts\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\nHello =C3=A9\r\n--parts\r\nContent-Type: text/html; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\nPHA+SGVsbG8gw6k8L3A+\r\n--parts--\r\n';
    fs.writeFileSync(path.join(root, 'saved.eml'), source);
    const manifest = { folders: { inbox: { messages: { 1: { file: 'saved.eml', complete: true }, 2: { file: 'partial.eml', complete: false }, 3: { file: outside } } } } };
    fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify(manifest));
    const mail = await readSavedMail(root, 'saved.eml');
    assert.equal(mail.subject, 'Hello \u00e9');
    assert.match(mail.text, /Hello \u00e9/);
    assert.match(mail.html, /<p>Hello \u00e9<\/p>/);
    await assert.rejects(readSavedMail(root, 'partial.eml'), /not in the saved mailbox/);
    await assert.rejects(readSavedMail(root, 'unknown.eml'), /not in the saved mailbox/);
    fs.writeFileSync(outside, 'Private data');
    await assert.rejects(readSavedMail(root, outside), /Invalid saved email path/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(outside, { force: true }); }
});
