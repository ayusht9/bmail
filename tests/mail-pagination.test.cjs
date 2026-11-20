const test = require('node:test');
const assert = require('node:assert/strict');
const { paginateMail } = require('../engine/mail-page.cjs');

test('pagination sorts the entire list before slicing and clamps shrinking or invalid pages', () => {
  const rows = Array.from({ length: 123 }, (_, index) => ({ id: `mail-${index + 1}`, subject: `Message ${index + 1}`, bytes: 123 - index }));
  const options = { pageSize: 50, sortColumn: 'subject', sortDirection: 'asc' };
  const first = paginateMail(rows, options);
  const second = paginateMail(rows, { ...options, page: 2 });
  const last = paginateMail(rows, { ...options, page: 999 });
  assert.equal(first.rows[0].subject, 'Message 1');
  assert.equal(first.rows.at(-1).subject, 'Message 50');
  assert.equal(second.rows[0].subject, 'Message 51');
  assert.equal(last.page, 3);
  assert.equal(last.rows.length, 23);
  assert.equal(last.rows.at(-1).subject, 'Message 123');
  assert.equal(new Set([...first.rows, ...second.rows, ...last.rows].map(row => row.id)).size, 123);
  assert.equal(paginateMail(rows.slice(0, 12), { ...options, page: 3 }).page, 1);
  assert.equal(paginateMail(rows, { ...options, page: -1 }).page, 1);
  assert.equal(paginateMail(rows, { page: Infinity, pageSize: 1000000 }).pageSize, 50);
  assert.deepEqual(paginateMail([], options), { rows: [], total: 0, page: 1, pages: 1, pageSize: 50 });
  const numeric = paginateMail(rows, { pageSize: 25, sortColumn: 'bytes', sortDirection: 'desc' });
  assert.equal(numeric.rows[0].bytes, 123);
  assert.equal(numeric.pages, 5);
  assert.equal(rows[0].subject, 'Message 1', 'Sorting must not mutate the source list');
});

test('empty and loading pagers expose disabled, named controls', async () => {
  const { mailPagination } = await import('../src/mail-pagination.js');
  const empty = mailPagination({});
  assert.match(empty, /0 messages/);
  assert.match(empty, /Page 1 of 1/);
  assert.equal((empty.match(/ disabled/g) || []).length, 4);
  const loading = mailPagination({ loading: true, page: 2, pages: 5, pageSize: 25, total: 123 });
  assert.equal((loading.match(/ disabled/g) || []).length, 5);
  assert.match(loading, /26-50 of 123 messages/);
});

 test('mail search filters the entire index before pagination and matches every term', () => {
  const rows = Array.from({ length: 80 }, (_, i) => ({ subject: `Invoice ${i}`, sender: i === 79 ? 'Alice@example.com' : 'Bob@example.com', folder: 'Receipts' }));
  const result = paginateMail(rows, { query: 'ALICE invoice receipts', pageSize: 25 });
  assert.equal(result.total, 1);
  assert.equal(result.rows[0].subject, 'Invoice 79');
  assert.equal(paginateMail(rows, { query: 'missing' }).total, 0);
  assert.equal(paginateMail(rows, { query: '  ' }).total, 80);
});

test('universal search filters settings and features and matches descriptive keywords', async () => {
  const { matchDestinations } = await import('../src/universal-search.js');
  assert.equal(matchDestinations('dark', 'settings')[0][0], 'Theme');
  assert.equal(matchDestinations('dark', 'features').length, 0);
  assert.equal(matchDestinations('automatic', 'features')[0][0], 'Scheduler');
  assert.equal(matchDestinations('network', 'settings')[0][0], 'Scheduled backup settings');
  assert.equal(matchDestinations('nothing matches', 'all').length, 0);
});
