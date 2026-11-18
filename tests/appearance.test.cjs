const test = require('node:test');
const assert = require('node:assert/strict');

test('appearance preferences validate image policy, font family, and type size', async () => {
  const { normalizeAppearance, setAppearance, appearancePreference } = await import('../src/appearance.js');
  assert.deepEqual(normalizeAppearance(null), { imageMode: 'embedded', fontFamily: 'system', fontSize: 13 });
  assert.deepEqual(normalizeAppearance({ imageMode: 'hidden', fontFamily: 'georgia', fontSize: '18' }), { imageMode: 'hidden', fontFamily: 'georgia', fontSize: 18 });
  assert.deepEqual(normalizeAppearance({ imageMode: 'unsafe', fontFamily: '</style><script>', fontSize: 999 }), { imageMode: 'embedded', fontFamily: 'system', fontSize: 13 });
  setAppearance({ imageMode: 'hidden' });
  setAppearance({ fontFamily: 'consolas', fontSize: 16 });
  assert.deepEqual(appearancePreference(), { imageMode: 'hidden', fontFamily: 'consolas', fontSize: 16 }, 'Changing fonts preserves the image setting');
  const copy = appearancePreference();
  copy.imageMode = 'remote';
  assert.equal(appearancePreference().imageMode, 'hidden');
});
