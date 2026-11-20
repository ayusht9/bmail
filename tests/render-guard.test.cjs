const test = require('node:test');
const assert = require('node:assert/strict');

async function fixture() {
  const { createRenderGuard } = await import('../src/render-guard.js');
  const target = new EventTarget();
  const callbacks = new Map();
  let serial = 0, redraws = 0;
  const guard = createRenderGuard(target, () => redraws++, callback => { callbacks.set(++serial, callback); return serial; }, id => callbacks.delete(id));
  const send = (type, pointerId = 1) => { const event = new Event(type); event.pointerId = pointerId; target.dispatchEvent(event); };
  const flush = () => { const ready = [...callbacks.values()]; callbacks.clear(); ready.forEach(callback => callback()); };
  return { guard, send, flush, redraws: () => redraws };
}

test('a refresh during a press is deferred until after the click can run', async () => {
  const f = await fixture();
  f.send('pointerdown');
  assert.equal(f.guard.defer(), true);
  assert.equal(f.guard.defer(), true);
  f.send('pointerup');
  assert.equal(f.redraws(), 0);
  f.flush();
  assert.equal(f.redraws(), 1, 'Multiple pending updates produce one redraw');
});

test('the click handler can redraw without a duplicate pending refresh', async () => {
  const f = await fixture();
  f.send('pointerdown'); f.guard.defer(); f.send('pointerup');
  f.send('click');
  assert.equal(f.guard.defer(), false);
  f.flush();
  assert.equal(f.redraws(), 0);
});

test('refreshes between pointerup and click cannot disconnect the first click target', async () => {
  const f = await fixture();
  f.send('pointerdown');
  f.send('pointerup');
  assert.equal(f.guard.defer(), true, 'Even a refresh first arriving after release must wait');
  assert.equal(f.redraws(), 0);
  f.send('click');
  assert.equal(f.guard.defer(), false, 'The click handler can render its destination immediately');
  f.flush();
  assert.equal(f.redraws(), 0);
});

test('cancellation and window blur release pending redraws, while other held pointers keep them deferred', async () => {
  const f = await fixture();
  f.send('pointerdown', 1); f.send('pointerdown', 2); f.guard.defer();
  f.send('pointercancel', 1); f.flush();
  assert.equal(f.redraws(), 0);
  f.send('pointercancel', 2); f.flush();
  assert.equal(f.redraws(), 1);
  f.send('pointerdown'); f.guard.defer(); f.send('blur'); f.flush();
  assert.equal(f.redraws(), 2);
});
