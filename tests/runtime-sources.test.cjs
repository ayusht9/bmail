const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runtimeSources, syncRuntimeSources } = require('../scripts/runtime-sources.cjs');

test('runtime refresh supplies cloud workers and dependencies, excludes personal files, and leaves the Node executable intact', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bmail-runtime-refresh-'));
  try {
    fs.mkdirSync(path.join(root, 'engine')); const output = path.join(root, 'runtime'); fs.mkdirSync(output);
    for (const name of runtimeSources) fs.writeFileSync(path.join(root, 'engine', name), `source:${name}`);
    for (const name of ['backup-config.json', '.env.local', 'private-token.json', 'email.eml', 'debug.log']) fs.writeFileSync(path.join(root, 'engine', name), 'private');
    fs.writeFileSync(path.join(output, 'node.exe'), 'existing locked runtime');
    assert.equal(syncRuntimeSources(root, output), runtimeSources.length);
    for (const name of ['cloud-dropbox.cjs', 'dropbox-client.cjs', 'dropbox-messages.json', 'cloud-drive.cjs', 'drive-client.cjs', 'Drive-Credentials.ps1']) assert.equal(fs.readFileSync(path.join(output, name), 'utf8'), `source:${name}`);
    assert.equal(fs.readFileSync(path.join(output, 'node.exe'), 'utf8'), 'existing locked runtime');
    assert.equal(fs.existsSync(path.join(output, 'private-token.json')), false);
    assert.equal(fs.existsSync(path.join(output, 'backup-config.json')), false);
    assert.equal(fs.existsSync(path.join(output, '.env.local')), false);
    assert.equal(syncRuntimeSources(root, output), 0);
    fs.writeFileSync(path.join(root, 'engine', 'cloud-dropbox.cjs'), 'updated worker');
    assert.equal(syncRuntimeSources(root, output), 1);
    assert.equal(fs.readFileSync(path.join(output, 'cloud-dropbox.cjs'), 'utf8'), 'updated worker');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
