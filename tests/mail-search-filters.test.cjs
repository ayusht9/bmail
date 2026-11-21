const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { metadataPage } = require('../engine/mail-metadata.cjs');
const { paginateMail } = require('../engine/mail-page.cjs');
const { listMailPage } = require('../engine/read-mail.cjs');

const rows = Array.from({ length: 90 }, (_, i) => ({ id: String(i), subject: `Invoice ${i}`, sender: i % 2 ? 'Alice@example.test' : 'Bob %_@example.test', folder: i % 3 ? 'INBOX' : 'Sent', backedUp: i % 4 === 0,
  sentAt: i === 89 ? null : new Date(2026, 10, i % 3 + 1, i % 24, 30).toISOString() }));

test('SQLite and fallback combine sender, folder, dates, backup status and search before pagination', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bmail-filter-'));
  try {
    const cases = [
      { sender: 'ALICE' }, { sender: '%_' }, { backupStatus: 'saved' }, { backupStatus: 'missing' },
      { dateFrom: '2026-11-02' }, { dateTo: '2026-11-02' },
      { dateFrom: '2026-11-02', dateTo: '2026-11-02' },
      { sender: 'bob', dateFrom: '2026-11-01', dateTo: '2026-11-03', backupStatus: 'saved' },
      { sender: "' OR 1=1 --" }, {},
    ];
    for (const filters of cases) {
      for (const page of [1, 2, 999]) {
        const options = { filters, folder: 'INBOX', query: 'invoice', page, pageSize: 25 };
        assert.deepEqual(metadataPage(root, '1', rows, options), paginateMail(rows, options));
      }
    }
    const senderChoices = metadataPage(root, '1', rows, { includeSenders: true, query: 'no matching messages', filters: { sender: 'nobody' } });
    assert.equal(senderChoices.total, 0);
    assert.deepEqual(senderChoices.senders, ['Alice@example.test', 'Bob %_@example.test']);
    const oneDay = metadataPage(root, '1', rows, { filters: { dateFrom: '2026-11-02', dateTo: '2026-11-02' }, pageSize: 100 });
    assert.equal(oneDay.total, 30);
    assert.ok(oneDay.rows.every(row => new Date(row.sentAt).getDate() === 2));
    assert.equal(metadataPage(root, '1', rows, { filters: { backupStatus: 'saved' } }).total, 23);
    for (const filters of [{ dateFrom: '2026-11-03', dateTo: '2026-11-01' }, { dateFrom: '2026-02-30' }, { dateTo: 'bad' }]) {
      assert.throws(() => metadataPage(root, '1', rows, { filters }), /date/i);
      assert.throws(() => paginateMail(rows, { filters }), /date/i);
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('old metadata schemas migrate even when the mailbox revision is unchanged', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bmail-filter-migrate-'));
  fs.mkdirSync(path.join(root, '.cache'));
  const db = new DatabaseSync(path.join(root, '.cache', 'mail-metadata.db'));
  db.exec("CREATE TABLE messages(id TEXT PRIMARY KEY, folder TEXT, search TEXT, payload TEXT); CREATE TABLE revision(id INTEGER PRIMARY KEY, value TEXT); INSERT INTO revision VALUES (1, 'same');");
  db.close();
  try {
    assert.equal(metadataPage(root, 'same', rows, { filters: { backupStatus: 'saved' } }).total, 23);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('reader still honors filters when the SQLite cache cannot be created', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bmail-filter-fallback-'));
  const messages = Object.fromEntries(rows.map(row => [row.id, { ...row, uid: Number(row.id) + 1 }]));
  fs.writeFileSync(path.join(root, 'mail-index.json'), JSON.stringify({ folders: { inbox: { name: 'INBOX', messages } } }));
  fs.writeFileSync(path.join(root, '.cache'), 'block directory creation');
  try {
    const result = await listMailPage(root, { query: 'invoice', filters: { sender: 'ALICE', dateFrom: '2026-11-02', dateTo: '2026-11-02', backupStatus: 'missing' } });
    assert.equal(result.total, 15);
    assert.ok(result.rows.every(row => row.sender === 'Alice@example.test' && !row.backedUp));
    const choices = await listMailPage(root, { includeSenders: true, query: 'no matches' });
    assert.equal(choices.total, 0);
    assert.deepEqual(choices.senders, ['Alice@example.test', 'Bob %_@example.test']);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
