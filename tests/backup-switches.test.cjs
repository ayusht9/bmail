const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { backupEnabled } = require('../engine/paths.cjs');
const { createControl } = require('../engine/backup-control.cjs');

test('a scheduler kill switch stops at a safe message boundary', async () => {
  let disabled = false;
  const controls = createControl('.', { close() {} }, { context: { runId: 'fixture' }, publish() {} }, () => null, () => disabled);
  try {
    controls.beginMessage();
    disabled = true;
    await controls.checkpoint(false);
    controls.endMessage();
    await assert.rejects(controls.checkpoint(), error => error.outcome === 'stopped');
  } finally { controls.dispose(); }
});

test('global backup switches apply to every profile and block unconfigured cloud runs', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'bmail-switches-'));
  try {
    const data = path.join(base, 'accounts', 'first');
    fs.mkdirSync(data, { recursive: true });
    assert.equal(backupEnabled(data, 'cloud'), true);
    fs.writeFileSync(path.join(base, 'desktop-settings.json'), JSON.stringify({ cloudBackupsEnabled: false, scheduledBackupsEnabled: false }));
    for (const account of ['first', 'second']) {
      assert.equal(backupEnabled(path.join(base, 'accounts', account), 'cloud'), false);
      assert.equal(backupEnabled(path.join(base, 'accounts', account), 'schedule'), false);
    }
    for (const name of ['drive', 'dropbox', 'icloud']) {
      // No credentials or provider setup: a disabled run must exit before either is needed.
      const status = await require(`../engine/cloud-${name}.cjs`).run(data, 'sync');
      assert.notEqual(status.stage, 'error');
    }
    const launcher = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.resolve('engine/Run-Backup.ps1'), '-Scheduled'], {
      env: { ...process.env, MAIL_VAULT_DATA_DIR: data }, encoding: 'utf8', timeout: 15000,
    });
    assert.equal(launcher.status, 0, launcher.stdout + launcher.stderr);
    assert.match(launcher.stdout, /disabled globally/);
    fs.writeFileSync(path.join(base, 'desktop-settings.json'), '{broken');
    assert.equal(backupEnabled(data, 'cloud'), false, 'Unreadable settings cannot bypass the switch');
    fs.writeFileSync(path.join(base, 'desktop-settings.json'), '{"closeToTray":false}');
    assert.equal(backupEnabled(data, 'cloud'), true, 'Old preferences retain existing backup behavior');
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});
