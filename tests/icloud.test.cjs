const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { run, publicStatus, syncAfterBackup } = require('../engine/cloud-icloud.cjs');
const { readJson, writeJson } = require('../engine/cloud-drive.cjs');
const sha = value => crypto.createHash('sha256').update(value).digest('hex');

function fixture() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'bmail-icloud-'));
  const data = path.join(base, 'account'), destination = path.join(base, 'iCloud Drive');
  const root = path.join(data, 'backups');
  fs.mkdirSync(root, { recursive: true }); fs.mkdirSync(destination);
  const source = Buffer.from('From: fixture@icloud.com\r\nSubject: Local mail\r\n\r\nVerified message');
  fs.writeFileSync(path.join(root, 'one.eml'), source);
  const config = { user: 'fixture@icloud.com', host: 'imap.mail.me.com', backupDirectory: 'backups' };
  const manifest = { version: 1, user: config.user, host: config.host, folders: { inbox: { name: 'INBOX', uidValidity: '1', messages: { 1: { file: 'one.eml', subject: 'Local mail', bytes: source.length, sha256: sha(source), complete: true } } } } };
  writeJson(path.join(data, 'backup-config.json'), config); writeJson(path.join(root, 'manifest.json'), manifest);
  fs.mkdirSync(path.join(data, '.private')); fs.writeFileSync(path.join(data, '.private', 'secret.xml'), 'fixture-secret');
  fs.writeFileSync(path.join(root, 'mail-metadata.db'), 'runtime-cache');
  return { base, data, destination, root, source, config, manifest, cleanup: () => fs.rmSync(base, { recursive: true, force: true }) };
}

test('iCloud folder setup is opt-in, cancellation preserves settings, and only verified mail and manifest are copied', async () => {
  const f = fixture();
  try {
    assert.deepEqual(publicStatus(f.data), {});
    let state = await run(f.data, 'setup', f.destination);
    assert.equal(state.connected, true); assert.equal(state.automatic, false);
    assert.equal('destination' in state, false); assert.equal('pid' in state, false);
    const before = fs.readFileSync(path.join(f.data, 'cloud-icloud.json'));
    await run(f.data, 'setup', null);
    assert.deepEqual(fs.readFileSync(path.join(f.data, 'cloud-icloud.json')), before);
    state = await run(f.data, 'sync');
    assert.equal(state.stage, 'copied'); assert.ok(state.lastCopiedAt);
    assert.equal(state.completedFiles, state.totalFiles);
    assert.equal('lastSyncedAt' in state, false, 'A local copy must not claim an Apple upload');
    const copied = readJson(path.join(state.folderName, 'manifest.json'));
    const record = copied.folders.inbox.messages[1];
    assert.deepEqual(fs.readFileSync(path.join(state.folderName, record.file)), f.source);
    assert.equal(record.sha256, sha(f.source));
    assert.deepEqual(fs.readdirSync(state.folderName).sort(), ['manifest.json', 'messages']);
    assert.deepEqual(readJson(path.join(f.root, 'manifest.json')), f.manifest, 'The local archive is unchanged');
    state = await run(f.data, 'sync');
    assert.equal(state.skippedFiles, 2);
    fs.writeFileSync(path.join(state.folderName, record.file), 'damaged destination');
    state = await run(f.data, 'sync');
    assert.equal(state.stage, 'copied'); assert.equal(state.skippedFiles, 1);
    assert.deepEqual(fs.readFileSync(path.join(state.folderName, record.file)), f.source);
    const snapshot = fs.readFileSync(path.join(state.folderName, 'manifest.json'));
    await run(f.data, 'disconnect');
    assert.equal(publicStatus(f.data).connected, false); assert.equal(publicStatus(f.data).automatic, false);
    assert.deepEqual(fs.readFileSync(path.join(state.folderName, 'manifest.json')), snapshot, 'Disconnect retains copied files');
  } finally { f.cleanup(); }
});

test('iCloud copies isolate mailbox identities and reject local-source overlap and directory links', async () => {
  const f = fixture();
  try {
    for (const folder of [f.data, f.root, f.base]) assert.equal((await run(f.data, 'setup', folder)).errorCode, 'overlap');
    assert.equal((await run(f.data, 'setup', path.join(f.base, 'missing'))).errorCode, 'folder');
    let state = await run(f.data, 'setup', f.destination);
    const firstDestination = state.folderName;
    const other = path.join(f.base, 'other-account'); fs.mkdirSync(other);
    writeJson(path.join(other, 'backup-config.json'), { ...f.config, user: 'other@icloud.com' });
    assert.notEqual((await run(other, 'setup', f.destination)).folderName, firstDestination);
    const external = path.join(f.base, 'outside'); fs.mkdirSync(external);
    const link = path.join(f.destination, 'Bmail'); fs.symlinkSync(external, link, process.platform === 'win32' ? 'junction' : 'dir');
    assert.equal((await run(f.data, 'sync')).errorCode, 'folder');
    assert.deepEqual(fs.readdirSync(external), []);
    fs.unlinkSync(link);
  } finally { f.cleanup(); }
});

test('corrupt or incomplete source data never overwrites the last complete iCloud manifest', async () => {
  const f = fixture();
  try {
    await run(f.data, 'setup', f.destination);
    const original = await run(f.data, 'sync');
    const filename = path.join(original.folderName, 'manifest.json');
    const before = fs.readFileSync(filename);
    fs.writeFileSync(path.join(f.root, 'one.eml'), 'broken');
    assert.equal((await run(f.data, 'sync')).errorCode, 'files');
    assert.deepEqual(fs.readFileSync(filename), before);
    fs.writeFileSync(path.join(f.root, 'one.eml'), f.source);
    f.manifest.folders.inbox.messages[1].complete = false;
    writeJson(path.join(f.root, 'manifest.json'), f.manifest);
    assert.equal((await run(f.data, 'sync')).errorCode, 'files');
    assert.deepEqual(fs.readFileSync(filename), before);
  } finally { f.cleanup(); }
});

test('interrupted copying retains the previous archive and removes temporary files; changed copy bytes are rejected', async () => {
  const f = fixture();
  try {
    await run(f.data, 'setup', f.destination);
    const original = await run(f.data, 'sync');
    const before = fs.readFileSync(path.join(original.folderName, 'manifest.json'));
    const source = Buffer.from('Subject: Changed mail\r\n\r\nA new message');
    fs.writeFileSync(path.join(f.root, 'one.eml'), source);
    Object.assign(f.manifest.folders.inbox.messages[1], { bytes: source.length, sha256: sha(source) });
    const second = Buffer.from('Subject: Second mail\r\n\r\nAnother new message');
    fs.writeFileSync(path.join(f.root, 'two.eml'), second);
    f.manifest.folders.inbox.messages[2] = { file: 'two.eml', bytes: second.length, sha256: sha(second), complete: true };
    writeJson(path.join(f.root, 'manifest.json'), f.manifest);
    let state = await run(f.data, 'sync', null, { copyFile: async () => { throw Object.assign(new Error('private-path'), { code: 'ENOSPC' }); } });
    assert.equal(state.errorCode, 'disk'); assert.equal(state.lastCopiedAt, original.lastCopiedAt);
    assert.deepEqual(fs.readFileSync(path.join(original.folderName, 'manifest.json')), before);
    state = await run(f.data, 'sync', null, { copyFile: async (source, target) => fs.writeFileSync(target, 'changed during copying') });
    assert.equal(state.errorCode, 'files');
    assert.deepEqual(fs.readFileSync(path.join(original.folderName, 'manifest.json')), before);
    assert.ok(fs.readdirSync(path.join(original.folderName, 'messages')).every(file => file.endsWith('.eml')));
    let copiedFiles = 0;
    state = await run(f.data, 'sync', null, { copyFile: async (...args) => {
      if (++copiedFiles === 2) throw new Error('interrupted after first file');
      await fs.promises.copyFile(...args);
    } });
    assert.equal(state.stage, 'error');
    assert.deepEqual(fs.readFileSync(path.join(original.folderName, 'manifest.json')), before, 'Publishing some new files does not replace the old manifest');
    state = await run(f.data, 'sync'); assert.equal(state.stage, 'copied');
    const copied = readJson(path.join(state.folderName, 'manifest.json'));
    assert.deepEqual(fs.readFileSync(path.join(state.folderName, copied.folders.inbox.messages[1].file)), source);
    assert.equal(fs.readdirSync(path.join(state.folderName, 'messages')).length, 3, 'Previously copied emails are retained');
  } finally { f.cleanup(); }
});

test('iCloud automatic copying is opt-in, queues behind an active copy and does not affect local backup success', async () => {
  const f = fixture();
  try {
    await run(f.data, 'setup', f.destination);
    await syncAfterBackup(f.data);
    assert.equal(fs.existsSync(path.join(publicStatus(f.data).folderName, 'manifest.json')), false);
    await run(f.data, 'automatic', true);
    let unblock, started;
    const held = new Promise(resolve => { unblock = resolve; });
    const copying = new Promise(resolve => { started = resolve; });
    const active = run(f.data, 'sync', null, { copyFile: async (...args) => { started(); await held; await fs.promises.copyFile(...args); } });
    await copying;
    const next = Buffer.from('Subject: Arrived during copy\r\n\r\nNew mail');
    fs.writeFileSync(path.join(f.root, 'two.eml'), next);
    f.manifest.folders.inbox.messages[2] = { file: 'two.eml', bytes: next.length, sha256: sha(next), complete: true };
    writeJson(path.join(f.root, 'manifest.json'), f.manifest);
    await assert.rejects(run(f.data, 'disconnect'), { code: 'busy' });
    await syncAfterBackup(f.data);
    assert.ok(fs.existsSync(path.join(f.data, '.private', 'icloud-resync')));
    unblock(); await active;
    assert.equal(publicStatus(f.data).stage, 'copied');
    assert.ok(readJson(path.join(publicStatus(f.data).folderName, 'manifest.json')).folders.inbox.messages[2], 'Queued copying includes mail backed up during the previous copy');
    assert.equal(fs.existsSync(path.join(f.data, '.private', 'icloud-resync')), false);
    fs.unlinkSync(path.join(f.root, 'one.eml'));
    await syncAfterBackup(f.data);
    assert.equal(publicStatus(f.data).stage, 'error');
    assert.equal(readJson(path.join(f.root, 'manifest.json')).folders.inbox.messages[1].sha256, sha(f.source));
  } finally { f.cleanup(); }
});

test('destination file symlinks cannot escape the iCloud copy boundaries', async () => {
  const f = fixture();
  try {
    await run(f.data, 'setup', f.destination);
    let state = await run(f.data, 'sync');
    const manifestPath = path.join(state.folderName, 'manifest.json');
    const before = fs.readFileSync(manifestPath);
    const outside = path.join(f.base, 'outside-file'); fs.writeFileSync(outside, 'outside must remain');
    const link = path.join(state.folderName, 'manifest.json');
    fs.unlinkSync(link);
    try { fs.symlinkSync(outside, link); }
    catch (error) { if (process.platform === 'win32' && error.code === 'EPERM') { fs.writeFileSync(link, before); return; } throw error; }
    state = await run(f.data, 'sync'); assert.equal(state.errorCode, 'folder');
    assert.equal(fs.readFileSync(outside, 'utf8'), 'outside must remain');
    fs.unlinkSync(link); fs.writeFileSync(link, before);
  } finally { f.cleanup(); }
});

test('source directory links cannot copy mail from outside the archive', async () => {
  const f = fixture();
  try {
    const outside = path.join(f.base, 'outside-mail'); fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'secret.eml'), f.source);
    const link = path.join(f.root, 'linked-mail');
    fs.symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
    f.manifest.folders.inbox.messages[1].file = 'linked-mail/secret.eml';
    writeJson(path.join(f.root, 'manifest.json'), f.manifest);
    await run(f.data, 'setup', f.destination);
    assert.equal((await run(f.data, 'sync')).errorCode, 'files');
    assert.deepEqual(fs.readdirSync(f.destination), []);
    fs.unlinkSync(link);
  } finally { f.cleanup(); }
});

test('iCloud Mail is detected, enforces port 993, and stores its app password with Windows encryption', { skip: process.platform !== 'win32' }, async () => {
  const { providerForHost } = await import('../src/mail-providers.js');
  assert.equal(providerForHost(' IMAP.MAIL.ME.COM '), 'icloud');
  const f = fixture();
  const data = path.join(f.base, 'mail-setup');
  const env = { ...process.env, MAIL_VAULT_DATA_DIR: data };
  const settings = { user: 'setup@icloud.com', host: 'imap.mail.me.com', port: 25, password: 'fixture-app-password' };
  try {
    const save = request => spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.resolve('engine/Save-Mailbox.ps1')], { input: JSON.stringify(request), env, encoding: 'utf8', windowsHide: true, timeout: 20000 });
    const invalid = save(settings);
    assert.notEqual(invalid.status, 0); assert.equal(JSON.parse(invalid.stdout).errorCode, 'ICLOUD_REQUIRES_993');
    const saved = save({ ...settings, port: 993 }); assert.equal(saved.status, 0, saved.stderr);
    assert.equal(readJson(path.join(data, 'backup-config.json')).host, 'imap.mail.me.com');
    const credential = fs.readFileSync(path.join(data, '.private', 'zoho-credential.xml'), 'utf8');
    assert.equal(credential.includes(settings.password), false); assert.equal(saved.stdout.includes(settings.password), false);
  } finally { f.cleanup(); }
});
