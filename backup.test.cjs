const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { messageLocation, organize, verify, digest, backup } = require('./backup.cjs');
const key = 'a'.repeat(64) + '-1';

test('decoded subjects, India month boundaries, and Windows filenames', () => {
  const source = Buffer.from('From: Accounts Team <accounts@example.com>\r\nDate: Sat, 31 Oct 2026 23:30:00 +0000\r\nSubject: =?UTF-8?B?SW52b2ljZTogT2N0b2Jlcg==?=\r\n\r\nbody');
  const result = messageLocation('INBOX', key, 42, source);
  assert.equal(result.subject, 'Invoice: October');
  assert.equal(result.sender, 'accounts@example.com');
  assert.equal(result.file, path.join('messages', 'INBOX__aaaaaaaaaaaa-1', '2026-11', '2026-11-01_accounts@example.com_Invoice_ October__42.eml'));
  assert.notEqual(result.file, messageLocation('INBOX', key, 43, source).file);
  const fallback = messageLocation('Sent', key, 1, Buffer.from('Date: invalid\nSubject: \n\nbody'), '2026-03-01T00:00:00Z');
  assert.ok(fallback.file.endsWith('2026-03-01_Unknown sender_No subject__1.eml'));
  assert.equal(messageLocation('Sent', key, 1, Buffer.from('From: person@example.com\r\n\r\nbody')).sender, 'person@example.com');
  assert.equal(messageLocation('Sent', key, 1, Buffer.from('From: =?UTF-8?B?QWxpY2U=?=\r\n\r\nbody')).sender, 'Alice');
  assert.ok(messageLocation('Sent', key, 1, Buffer.from('\n\nbody')).file.includes('Unknown-month'));
});

function mockMailbox(folders, onFetch = () => {}) {
  let current;
  const client = {
    mailbox: null, connect: async () => {}, close: () => {},
    list: async () => Object.keys(folders).map(name => ({ path: name, flags: new Set() })),
    getMailboxLock: async (name, options) => {
      assert.equal(options.readOnly, true);
      current = name; client.mailbox = { uidValidity: 1 };
      return { release() {} };
    },
    search: async () => Object.keys(folders[current]).map(Number),
    fetchOne: async (uid, query) => {
      await onFetch(current, uid, query);
      const source = folders[current][uid];
      if (!query.source) return { uid, size: source.length, internalDate: new Date('2026-11-01T00:00:00Z'), flags: [] };
      return { uid, source: source.subarray(query.source.start, query.source.start + query.source.maxLength), partialOrigins: new Map([['', query.source.start]]) };
    },
  };
  return client;
}

test('live progress discovers the full workload and publishes verified downloads before completion', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mail-progress-'));
  const message = Buffer.from('Subject: Example\r\n\r\nOriginal bytes');
  const observed = [];
  try {
    const client = mockMailbox({ INBOX: { 1: message, 2: message }, Sent: { 3: message } }, () => {
      observed.push(JSON.parse(fs.readFileSync(path.join(root, 'progress.json'))));
    });
    const result = await backup(client, root, { user: 'test@example.com', host: 'imap.example.com' }, () => {});
    assert.equal(result.success, true);
    assert.equal(result.downloaded, 3);
    assert.ok(observed.every(p => p.totalMessages === 3 && p.totalFolders === 2));
    assert.ok(observed.some(p => p.downloaded > 0 && p.state === 'running'));
    const progress = JSON.parse(fs.readFileSync(path.join(root, 'progress.json')));
    assert.equal(progress.state, 'completed');
    assert.equal(progress.processedMessages, 3);
    assert.equal(progress.downloaded, 3);
    assert.equal(progress.savedBytes, message.length * 3);
    assert.equal(fs.existsSync(path.join(root, '.backup.lock')), false);
    const second = await backup(mockMailbox({ INBOX: { 1: message, 2: message }, Sent: { 3: message } }), root,
      { user: 'test@example.com', host: 'imap.example.com' }, () => {});
    assert.equal(second.downloaded, 0);
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'progress.json'))).processedMessages, 3);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('migration preserves bytes, updates manifest, and is repeatable', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'email-organize-test-'));
  try {
    const source = Buffer.from('Subject: Example\r\nDate: 1 Oct 2026 12:00:00 +0530\r\n\r\nOriginal body\x00');
    fs.writeFileSync(path.join(root, 'old.eml'), source);
    const manifest = { folders: { [key]: { name: 'INBOX', messages: {
      1: { file: 'old.eml', bytes: source.length, sha256: digest(source) }
    } } } };
    assert.equal(organize(root, manifest), 1);
    assert.deepEqual(verify(root, manifest), { checked: 1, invalid: [] });
    const saved = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json')));
    assert.deepEqual(saved, manifest);
    assert.deepEqual(fs.readFileSync(path.join(root, saved.folders[key].messages[1].file)), source);
    assert.equal(fs.existsSync(path.join(root, 'old.eml')), false);
    assert.equal(organize(root, manifest), 0);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
