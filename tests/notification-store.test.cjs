const test = require('node:test');
const assert = require('node:assert/strict');

test('mail notifications follow the current snapshot without repeated unread entries', async () => {
  const { createNotificationStore } = await import('../src/notification-store.js');
  let saved = [], state = {};
  const options = { read: () => saved, write: value => saved = structuredClone(value), readState: () => state, writeState: value => state = structuredClone(value) };
  const store = createNotificationStore(options);
  const sync = (target, count) => target.reconcile('first', count ? `${count} new emails` : null, { key: 'mail:current', prefix: 'mail:' });
  store.add('second', 'Other account', { key: 'mail:old' });
  sync(store, 3); store.markRead('first'); sync(store, 3);
  assert.equal(store.unread('first'), 0);
  assert.equal(store.list('first').length, 1);
  sync(store, 1);
  assert.equal(store.list('first')[0].message, '1 new emails');
  assert.equal(store.unread('first'), 1);
  sync(store, 0);
  assert.equal(store.list('first').length, 0);
  assert.equal(store.list('second').length, 1);
  sync(store, 3); store.clear('first');
  sync(createNotificationStore(options), 3);
  assert.equal(saved.filter(item => item.account === 'first').length, 0, 'Cleared current state does not reappear on the next poll or restart');
});

test('cleared backup notifications stay deduplicated across restarts', async () => {
  const { createNotificationStore } = await import('../src/notification-store.js');
  let saved = [], state = {};
  const options = { read: () => saved, write: value => saved = structuredClone(value), readState: () => state, writeState: value => state = structuredClone(value) };
  const store = createNotificationStore(options);
  store.add('account', 'Completed', { key: 'backup:run-1:completed' });
  store.clear('account');
  const reloaded = createNotificationStore(options);
  assert.equal(reloaded.add('account', 'Completed', { key: 'backup:run-1:completed' }), null);
  assert.ok(reloaded.add('account', 'Completed again', { key: 'backup:run-2:completed' }));
});

test('notification history persists, deduplicates events, and keeps account read states separate', async () => {
  const { createNotificationStore } = await import('../src/notification-store.js');
  let saved = [];
  const options = { read: () => saved, write: items => { saved = structuredClone(items); }, now: () => 1700000000000 };
  const store = createNotificationStore(options);
  const first = store.add('first@example.test', '<img src=x>', { level: 'error', key: 'run-1' });
  assert.equal(store.add('first@example.test', 'Duplicate run', { key: 'run-1' }), null);
  store.add('second@example.test', 'Other account', { key: 'run-1' });
  assert.equal(store.unread('first@example.test'), 1);
  store.markRead('first@example.test', first.id);
  assert.equal(store.unread('first@example.test'), 0);
  assert.equal(store.unread('second@example.test'), 1);
  const reloaded = createNotificationStore(options);
  assert.equal(reloaded.list('first@example.test')[0].message, 'Something went wrong. Please try again. If the problem continues, restart Bmail.');
  assert.equal(reloaded.list('first@example.test')[0].read, true);
  const next = reloaded.add('first@example.test', 'New message');
  assert.notEqual(next.id, first.id, 'IDs remain unique across reloads, even within one millisecond');
  const copy = reloaded.list('first@example.test');
  copy[0].message = 'Changed';
  assert.equal(reloaded.list('first@example.test')[0].message, 'New message');
  reloaded.clear('first@example.test');
  assert.equal(reloaded.list('first@example.test').length, 0);
  assert.equal(reloaded.list('second@example.test').length, 1);
});

test('notification history stays bounded and storage failures do not break session notifications', async () => {
  const { createNotificationStore } = await import('../src/notification-store.js');
  const store = createNotificationStore({ read: () => { throw new Error('blocked'); }, write: () => { throw new Error('quota exceeded'); } });
  for (let i = 0; i < 125; i++) store.add('account', `Message ${i}`);
  assert.equal(store.list('account').length, 100);
  assert.equal(store.list('account')[0].message, 'Message 124');
  store.markRead('account');
  assert.equal(store.unread('account'), 0);
  const corrupted = createNotificationStore({ read: () => [null, {}, { message: 'broken' }] });
  assert.deepEqual(corrupted.list('account'), []);
});
