const test = require('node:test');
const assert = require('node:assert/strict');

test('dashboard polling slows while idle, stays live during backups, and pauses when hidden or busy', async () => {
  const { createDashboardPoller } = await import('../src/polling.js');
  const state = { hidden: false, busy: false, controlBusy: false, backupRunning: false };
  const timers = new Map();
  let nextId = 0;
  let refreshes = 0;
  let fail = false;
  const poller = createDashboardPoller({ state: () => state, refresh: async () => { refreshes++; if (fail) throw new Error('offline'); },
    schedule(callback, delay) { const id = ++nextId; timers.set(id, { callback, delay }); return id; },
    cancel(id) { timers.delete(id); },
  });
  const onlyTimer = () => { assert.equal(timers.size, 1); return [...timers.values()][0]; };
  poller.start();
  assert.equal(onlyTimer().delay, 10000);
  await onlyTimer().callback();
  assert.equal(refreshes, 1);
  state.backupRunning = true;
  poller.reschedule();
  assert.equal(onlyTimer().delay, 2000);
  state.busy = true;
  await onlyTimer().callback();
  assert.equal(refreshes, 1, 'Do not issue dashboard calls during an operation');
  state.busy = false;
  state.hidden = true;
  await poller.wake();
  assert.equal(timers.size, 0);
  assert.equal(refreshes, 1);
  state.hidden = false;
  await poller.wake();
  assert.equal(refreshes, 2, 'Resume with an immediate refresh');
  assert.equal(onlyTimer().delay, 2000);
  fail = true;
  await onlyTimer().callback();
  assert.equal(refreshes, 3);
  assert.equal(onlyTimer().delay, 2000, 'Failures must not stop polling');
  state.backupRunning = false;
  poller.reschedule();
  assert.equal(onlyTimer().delay, 10000);
  poller.stop();
  assert.equal(timers.size, 0);
  await poller.wake();
  assert.equal(refreshes, 3);
});
