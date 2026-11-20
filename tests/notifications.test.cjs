const test = require('node:test');
const assert = require('node:assert/strict');

test('new-mail badges expose exact counts and safe contextual labels', async () => {
  const { normalizeNewMailCount, totalNewMail, newMailBadge } = await import('../src/notifications.js');
  for (const value of [-1, NaN, Infinity, undefined, 'bad']) assert.equal(normalizeNewMailCount(value), 0);
  assert.equal(normalizeNewMailCount('3.8'), 3);
  assert.equal(newMailBadge(0, String), '');
  const escape = value => value.replaceAll('<', '&lt;');
  const badge = newMailBadge(125, escape, '<Inbox>');
  assert.match(badge, />125<\/span>/);
  assert.match(badge, /125 new emails in &lt;Inbox>/);
  assert.doesNotMatch(badge, /in <Inbox>/);
  assert.equal(totalNewMail(new Map([['Inbox', 2], ['Sent', 0], ['Archive', 3]])), 5);
});

test('native badges coalesce changes, isolate accounts, clear zero, and retry failed updates', async () => {
  const { createBadgeSync } = await import('../src/notifications.js');
  const calls = [];
  let release;
  let fail = false;
  const sync = createBadgeSync(async (command, args) => {
    assert.equal(command, 'set_mail_badge');
    calls.push(args);
    if (calls.length === 1) await new Promise(resolve => { release = resolve; });
    if (fail) throw new Error('temporarily unavailable');
  });
  const pending = sync('first@example.com', 2);
  sync('first@example.com', 5);
  sync('second@example.com', 0);
  release();
  await pending;
  assert.deepEqual(calls, [{ account: 'first@example.com', count: 2 }, { account: 'second@example.com', count: 0 }]);
  await sync('second@example.com', 0);
  assert.equal(calls.length, 2, 'Unchanged badges do not issue native calls');
  fail = true;
  await sync('second@example.com', 9);
  fail = false;
  await sync('second@example.com', 9);
  assert.equal(calls.length, 4, 'A failed native update is retried');
  assert.equal(calls.at(-1).count, 9);
});
