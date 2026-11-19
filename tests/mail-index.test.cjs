const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { checkMailbox } = require('../engine/backup-stats.cjs');
const { listMailbox } = require('../engine/read-mail.cjs');
const { digest, readJson, atomicWrite } = require('../engine/backup.cjs');

test('mail index joins saved and server mail, tracks new UIDs, and isolates folder generations', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bmail-mail-index-'));
  let uids = [1, 2];
  let validity = '1';
  let fail = false;
  const batches = [];
  const key = digest(Buffer.from('INBOX')) + '-1';
  const bytes = Buffer.from('Subject: Saved message\r\n\r\nA saved body');
  const manifest = { folders: { [key]: { name: 'INBOX', messages: { 1: { file: 'saved.eml', subject: 'Saved message', sender: 'sender@example.test', bytes: bytes.length, sha256: digest(bytes), complete: true } } } } };
  fs.writeFileSync(path.join(root, 'saved.eml'), bytes);
  fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify(manifest));
  const client = {
    mailbox: { get uidValidity() { return validity; } },
    list: async () => [{ path: 'INBOX', flags: new Set() }],
    getMailboxLock: async (name, options) => { assert.equal(options.readOnly, true); return { release() {} }; },
    search: async () => uids,
    async *fetch(range, query, options) {
      assert.deepEqual(query, { envelope: true, size: true }, 'Indexing must never request message bodies or flags');
      assert.deepEqual(options, { uid: true });
      if (fail) throw new Error('Connection interrupted');
      const requested = range.split(',').map(Number);
      batches.push(requested);
      for (const uid of requested) yield { uid, size: 100, envelope: { subject: `Server message ${uid}`, from: [{ address: 'server@example.test' }], date: new Date('2026-11-18T00:00:00Z') } };
    },
  };
  const check = () => checkMailbox(client, root, manifest, { readJson, atomicWrite, newMailOnly: true, indexMessages: true });
  try {
    await check();
    let rows = await listMailbox(root);
    assert.equal(rows.length, 2, 'A saved server message appears only once');
    assert.equal(rows.find(row => row.uid === 1).backedUp, true);
    assert.equal(rows.find(row => row.uid === 2).backedUp, false);
    assert.ok(rows.every(row => !row.isNew), 'The first check establishes a baseline');
    uids = [1, 2, 3];
    await check();
    rows = await listMailbox(root);
    assert.equal(rows.find(row => row.uid === 3).isNew, true);
    assert.equal(rows.find(row => row.uid === 2).isNew, false);
    assert.deepEqual(batches, [[2], [3]], 'Unchanged server headers are cached; saved metadata is reused');
    assert.deepEqual(await listMailbox(root, 'Sent'), []);
    uids = [2, 3];
    await check();
    rows = await listMailbox(root);
    assert.equal(rows.find(row => row.uid === 1).onServer, false, 'Local backups survive server deletion');
    assert.equal(rows.find(row => row.uid === 1).backedUp, true);
    validity = '2';
    await check();
    rows = await listMailbox(root);
    assert.ok(rows.filter(row => row.onServer).every(row => !row.isNew && !row.backedUp), 'UID resets do not inherit backup or new-mail states');
    const previous = fs.readFileSync(path.join(root, 'mail-index.json'));
    uids = [2, 3, 4];
    fail = true;
    await assert.rejects(check(), /Connection interrupted/);
    assert.deepEqual(fs.readFileSync(path.join(root, 'mail-index.json')), previous, 'A failed check preserves the last complete index');
    fail = false;
    fs.writeFileSync(path.join(root, 'mail-index.json'), '{corrupt cache');
    await check();
    assert.equal((await listMailbox(root)).filter(row => row.onServer).length, 3, 'A corrupted derived index is rebuilt');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('message state labels can mark new and backed-up mail independently', async () => {
  const { mailStateLabels } = await import('../src/desktop.js');
  assert.match(mailStateLabels({ isNew: true, backedUp: true }), /New.*Backed up/);
  assert.match(mailStateLabels({ isNew: false, backedUp: false }), /Not backed up/);
  assert.doesNotMatch(mailStateLabels({ isNew: false, backedUp: false }), /state-new/);
  assert.doesNotMatch(mailStateLabels({ backedUp: true, onServer: false }), /Local only|state-local-only/);
});
