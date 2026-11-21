const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { watchMail } = require('../engine/mail-watch.cjs');

test('IDLE wakes on new mail and timed catch-up, checks read-only, and closes after failure', async () => {
  const client = new EventEmitter();
  let finishIdle; let checks = 0; let noops = 0; let opened = 0;
  client.capabilities = new Map([['IDLE', true]]);
  client.connect = async () => {};
  client.close = () => { client.emit('close'); finishIdle?.(); };
  client.mailboxOpen = async (folder, options) => { assert.equal(folder, 'INBOX'); assert.equal(options.readOnly, true); opened++; };
  client.noop = async () => { noops++; finishIdle(); };
  client.idle = () => new Promise(resolve => { finishIdle = resolve; if (checks === 1) setImmediate(() => client.emit('exists')); });
  await assert.rejects(watchMail(client, async () => { if (++checks === 3) throw new Error('offline'); }, { interval: 10 }), /offline/);
  assert.equal(checks, 3); assert.equal(opened, 2); assert.equal(noops, 2);
});

test('servers without IDLE use timed checks and stop on disconnection', async () => {
  const client = new EventEmitter(); let checks = 0;
  client.capabilities = new Map(); client.connect = async () => {};
  client.close = () => client.emit('close'); client.mailboxOpen = async () => {};
  await watchMail(client, async () => { if (++checks === 2) client.close(); }, { interval: 1 });
  assert.equal(checks, 2);
});
