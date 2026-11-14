const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { messageLocation, organize, verify, digest } = require('./backup.cjs');
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
