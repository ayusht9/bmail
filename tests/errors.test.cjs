const test = require('node:test');
const assert = require('node:assert/strict');

test('raw launcher timeout becomes an actionable message without network or exception details', async () => {
  const { userMessage, errorMessages } = await import('../src/errors.js');
  const raw = 'Backup failed. No server emails were deleted.\n{"name":"Error","message":"connect ETIMEDOUT 204.79.197.210:993","code":"ETIMEDOUT"}';
  assert.equal(userMessage(raw), errorMessages.timeout);
  assert.equal(userMessage({ name: 'Error', code: 'ETIMEDOUT', message: 'private endpoint' }), errorMessages.timeout);
  assert.equal(userMessage(userMessage(raw)), errorMessages.timeout);
  assert.equal(userMessage('authentication rejected: private credentials'), errorMessages.authentication);
  assert.equal(userMessage({ code: 'ENOTFOUND', message: 'getaddrinfo privatehost' }), errorMessages.server);
  assert.equal(userMessage('ENOSPC: C:\\private\\backup'), errorMessages.disk);
});

test('unknown errors never echo payloads, paths, stacks, or executable output', async () => {
  const { userMessage, errorMessages } = await import('../src/errors.js');
  for (const error of ['<script>private error</script>', new Error('token=fixture-secret at C:\\private\\module.js:52'), { message: 'fixture-secret', stack: 'private stack' }, null, { get message() { throw new Error('private getter'); } }]) {
    assert.equal(userMessage(error), errorMessages.generic);
  }
  assert.equal(userMessage(new Error('Choose at least one weekday.')), 'Choose at least one weekday.');
  assert.equal(userMessage('Enter your complete email address.'), 'Enter your complete email address.');
});

test('safe native invocation preserves busy control flow and provides operation-specific fallbacks', async () => {
  const { createSafeInvoke, errorMessages, userMessage } = await import('../src/errors.js');
  const invoke = createSafeInvoke(async command => { if (command === 'busy') throw 'NEW_MAIL_CHECK_BUSY'; throw 'fixture-private-error'; });
  await assert.rejects(invoke('busy'), error => error.code === 'NEW_MAIL_CHECK_BUSY' && userMessage(error) === errorMessages.busy);
  await assert.rejects(invoke('export_mail'), error => error.message === errorMessages.export && !String(error).includes('fixture-private'));
  await assert.rejects(invoke('configure_mailbox'), error => error.message === errorMessages.setup);
});

test('global handlers catch runtime errors and unhandled rejections without recursive failures', async () => {
  const { installGlobalErrorHandlers, errorMessages } = await import('../src/errors.js');
  const target = new EventTarget();
  const reported = [];
  const cleanup = installGlobalErrorHandlers(target, message => reported.push(message));
  for (const [type, key] of [['error', 'error'], ['unhandledrejection', 'reason']]) {
    const event = new Event(type, { cancelable: true });
    event[key] = new Error('fixture-private-error');
    target.dispatchEvent(event);
    assert.equal(event.defaultPrevented, true);
  }
  assert.deepEqual(reported, [errorMessages.generic, errorMessages.generic]);
  cleanup();
  target.dispatchEvent(new Event('error'));
  assert.equal(reported.length, 2);
  const clean = installGlobalErrorHandlers(target, () => { throw new Error('report failed'); });
  assert.doesNotThrow(() => target.dispatchEvent(new Event('error')));
  clean();
});

test('persisted notifications and Activity errors use the same safe presentation', async () => {
  const { errorMessages } = await import('../src/errors.js');
  const { createNotificationStore } = await import('../src/notification-store.js');
  const { historyPane } = await import('../src/history.js');
  let saved;
  const store = createNotificationStore({ read: () => [{ id: 'old', account: 'fixture', level: 'error', message: 'connect ETIMEDOUT 204.79.197.210:993', createdAt: new Date().toISOString() }], write: items => saved = items });
  assert.equal(store.list('fixture')[0].message, errorMessages.timeout);
  assert.equal(saved[0].message, errorMessages.timeout);
  const html = historyPane({ history: [{ runId: 'fixture', outcome: 'failed', error: { code: 'ETIMEDOUT', message: 'private endpoint' } }] }, 'all', 'fixture', String, String, String);
  assert.ok(html.includes(errorMessages.timeout));
  assert.doesNotMatch(html, /ETIMEDOUT|private endpoint/);
});
