const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { metadataPage } = require('../engine/mail-metadata.cjs');
const { paginateMail } = require('../engine/mail-page.cjs');
const { checkMailbox } = require('../engine/backup-stats.cjs');
const { readJson, atomicWrite } = require('../engine/backup.cjs');

test('persistent metadata queries retain natural sorting, literal search, isolation and revision updates', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bmail-db-'));
  const rows = Array.from({ length: 83 }, (_, i) => ({ id: String(i), subject: `Message ${i}`, sender: 'Ålice %_', folder: i % 2 ? 'INBOX' : 'Sent', sentAt: null, bytes: i }));
  try {
    for (const sortColumn of ['subject', 'sender', 'folder', 'sentAt', 'bytes', 'invalid']) {
      for (const sortDirection of ['asc', 'desc']) {
        const options = { sortColumn, sortDirection, page: 2, pageSize: 25, query: 'ålice %_', folder: 'INBOX' };
        assert.deepEqual(metadataPage(root, '1', rows, options), paginateMail(rows.filter(r => r.folder === 'INBOX'), options));
      }
    }
    assert.ok(fs.existsSync(path.join(root, '.cache', 'mail-metadata.db')));
    assert.equal(metadataPage(root, '2', rows.slice(0, 1)).total, 1);
    assert.equal(metadataPage(root, '2', rows.slice(0, 1), { query: "' OR 1=1 --" }).total, 0);
    fs.writeFileSync(path.join(root, '.cache', 'mail-metadata.db'), 'broken database');
    assert.equal(metadataPage(root, '2', rows.slice(0, 1)).total, 1);
    fs.unlinkSync(path.join(root, '.cache', 'mail-metadata.db'));
    assert.equal(metadataPage(root, '2', rows.slice(0, 1)).total, 1);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('new-mail checkpoints avoid full searches and reconcile deletions, expired checkpoints and UID resets', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bmail-delta-'));
  let uids = [1, 2]; let next = 3; let validity = '1';
  const searches = [];
  const client = {
    mailbox: { get uidValidity() { return validity; }, get uidNext() { return next; }, get exists() { return uids.length; } },
    list: async () => [{ path: 'INBOX', flags: new Set() }],
    getMailboxLock: async () => ({ release() {} }),
    search: async query => { searches.push(query); return query.all ? [...uids] : uids.filter(uid => uid >= Number(query.uid.split(':')[0])); },
  };
  const check = () => checkMailbox(client, root, null, { readJson, atomicWrite, newMailOnly: true });
  try {
    await check(); assert.deepEqual(searches.pop(), { all: true });
    await check(); assert.equal(searches.length, 0);
    uids.push(3); next = 4;
    assert.deepEqual((await check()).folders[0].newUids, [3]);
    assert.deepEqual(searches.pop(), { uid: '3:*' });
    uids = [2, 3]; await check(); assert.deepEqual(searches.pop(), { all: true });
    const file = path.join(root, 'new-mail-status.json');
    const old = readJson(file); old.folders[0].fullCheckedAt = '2000-01-01T00:00:00Z'; atomicWrite(file, JSON.stringify(old));
    await check(); assert.deepEqual(searches.pop(), { all: true });
    validity = '2'; assert.equal((await check()).folders[0].newMessages, null);
    assert.deepEqual(searches.pop(), { all: true });
    client.search = async () => { throw new Error('offline'); }; uids = [];
    const before = fs.readFileSync(file);
    await assert.rejects(check(), /offline/); assert.deepEqual(fs.readFileSync(file), before);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
