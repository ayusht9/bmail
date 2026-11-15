const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { checkMailbox } = require('./backup-stats.cjs');
const { digest, atomicWrite, readJson, validateRecord } = require('./backup.cjs');

test('full coverage checks every UID and folder, detects new mail, corruption and UID resets without downloading', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bmail-stats-'));
  const manifest = { folders: {} };
  const mail = { INBOX: [1, 2], Sent: [3] };
  let validity = '1';
  let releases = 0;
  let checks = 0;
  let current;
  const client = {
    mailbox: { get uidValidity() { return validity; } },
    list: async () => [...Object.keys(mail).map(path => ({ path, flags: new Set() })), { path: 'Hidden', flags: new Set(['\\Noselect']) }],
    getMailboxLock: async (folder, options) => { assert.equal(options.readOnly, true); current = folder; return { release() { releases++; } }; },
    search: async (query, options) => { checks++; assert.deepEqual(query, { all: true }); assert.deepEqual(options, { uid: true }); return mail[current]; },
  };
  const save = (folder, uid) => {
    const file = `${folder}-${uid}.eml`;
    const bytes = Buffer.from(`Subject: ${uid}\r\n\r\nMessage`);
    fs.writeFileSync(path.join(root, file), bytes);
    const key = digest(Buffer.from(folder)) + '-' + validity;
    (manifest.folders[key] ||= { name: folder, messages: {} }).messages[uid] = { file, bytes: bytes.length, sha256: digest(bytes), complete: true };
  };
  const check = () => checkMailbox(client, root, manifest, { atomicWrite, readJson, validateRecord });
  try {
    save('INBOX', 1);
    let stats = await check();
    assert.equal(stats.complete, false);
    assert.equal(stats.totalServerMessages, 3);
    assert.equal(stats.missingMessages, 2);
    assert.equal(stats.newMessages, null);
    save('INBOX', 2); save('Sent', 3);
    stats = await check();
    assert.equal(stats.complete, true);
    assert.equal(stats.newMessages, 0);
    const fullAt = stats.lastFullBackupAt;
    mail.INBOX.push(4);
    stats = await check();
    assert.equal(stats.newMessages, 1);
    assert.equal(stats.missingMessages, 1);
    assert.equal(stats.lastFullBackupAt, fullAt);
    fs.writeFileSync(path.join(root, 'INBOX-1.eml'), 'corrupted');
    stats = await check();
    assert.equal(stats.missingMessages, 2);
    assert.equal(stats.newMessages, 0);
    validity = '2';
    stats = await check();
    assert.equal(stats.savedMessages, 0);
    assert.equal(stats.newMessages, null, 'UID resets must not be reported as newly received mail');
    assert.equal(releases, checks);
    const before = fs.readFileSync(path.join(root, 'mailbox-status.json'));
    client.search = async () => { throw new Error('offline'); };
    await assert.rejects(check(), /offline/);
    assert.deepEqual(fs.readFileSync(path.join(root, 'mailbox-status.json')), before, 'failed checks retain the previous timestamped snapshot');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('coverage UI keeps unknown, partial, full and active backups distinct and escapes recent mail', async () => {
  const { backupCoverage, coverageRows, statisticsPanel, formatBytes } = await import('./src/statistics.js');
  assert.match(backupCoverage({}).title, /not checked/);
  assert.match(backupCoverage({ mailboxStatus: { complete: false } }).title, /incomplete/);
  assert.equal(backupCoverage({ mailboxStatus: { complete: true } }).complete, true);
  assert.equal(backupCoverage({ backupRunning: true, mailboxStatus: { complete: true } }).complete, false);
  assert.equal(formatBytes(1048576), '1.0 MB');
  const escape = value => String(value).replaceAll('<', '&lt;');
  const dashboard = { localStats: { messages: 2, bytes: 2048, folders: [{ name: '<Inbox>', messages: 2 }], recent: [{ subject: '<script>', folder: '<Inbox>', backedUpAt: 'date' }] },
    mailboxStatus: { complete: false, totalServerMessages: 3, savedMessages: 2, missingMessages: 1, newMessages: 1, checkedAt: 'date', previousCheckedAt: 'earlier' } };
  const html = statisticsPanel(dashboard, escape, String, String, false);
  assert.match(html, /value="66"/);
  assert.match(html, /&lt;script>/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(coverageRows(dashboard, escape, String), /&lt;Inbox>/);
});
