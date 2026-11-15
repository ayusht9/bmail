const test = require('node:test');
const assert = require('node:assert/strict');
const { manifest } = require('./scripts/ota-release.cjs');

test('release manifest pins signed Windows installer to its versioned GitHub release', () => {
  const input = { version: '0.2.1', repository: 'ayusht9/bmail', installer: 'Bmail_0.2.1_x64-setup.exe', signature: 'signature\n' };
  const data = manifest(input);
  assert.equal(data.platforms['windows-x86_64'].signature, 'signature');
  assert.equal(data.platforms['windows-x86_64'].url, 'https://github.com/ayusht9/bmail/releases/download/v0.2.1/Bmail_0.2.1_x64-setup.exe');
  assert.throws(() => manifest({ ...input, signature: '' }), /signed installer/);
  assert.throws(() => manifest({ ...input, repository: 'https://example.com' }), /owner\/repository/);
  assert.throws(() => manifest({ ...input, installer: '../Bmail_0.2.1_x64-setup.exe' }), /filename/);
  assert.throws(() => manifest({ ...input, version: '0.2.1-beta' }), /stable/);
});

test('updater checks once, reports progress, handles failed installs and retries', async () => {
  const { createUpdater } = await import('./src/updates.js');
  const calls = [];
  let failInstall = true;
  const updater = createUpdater({ changed() {}, channel: () => ({}), invoke: async (command, args) => {
    calls.push(command);
    if (command === 'check_update') return { configured: true, currentVersion: '0.2.0', version: '0.2.1', notes: '<b>Release notes</b>' };
    args.onProgress.onmessage({ downloaded: 50, total: 100 });
    assert.equal(updater.state.message, 'Downloading update: 50%');
    if (failInstall) throw 'Signature verification failed';
    args.onProgress.onmessage({ installing: true });
  } });
  await Promise.all([updater.check(), updater.check()]);
  assert.deepEqual(calls, ['check_update']);
  assert.equal(updater.state.phase, 'available');
  assert.equal(updater.state.notes, '<b>Release notes</b>');
  await updater.install();
  assert.equal(updater.state.phase, 'available');
  assert.match(updater.state.message, /Signature verification failed/);
  failInstall = false;
  await updater.install();
  assert.equal(updater.state.phase, 'installing');
  assert.match(updater.state.message, /restart/);
});

test('updater handles unconfigured builds, current versions, and connection failures', async () => {
  const { createUpdater } = await import('./src/updates.js');
  let response = { configured: false, currentVersion: '0.2.0' };
  const updater = createUpdater({ changed() {}, channel() {}, invoke: async () => {
    if (response instanceof Error) throw response;
    return response;
  } });
  await updater.install();
  await updater.check();
  assert.match(updater.state.message, /not configured/);
  response = { configured: true, currentVersion: '0.2.0' };
  await updater.check();
  assert.match(updater.state.message, /up to date/);
  response = new Error('offline');
  await updater.check();
  assert.equal(updater.state.phase, 'error');
  response = { configured: true, currentVersion: '0.2.0', version: '0.2.1' };
  await updater.check();
  assert.equal(updater.state.phase, 'available');
});
