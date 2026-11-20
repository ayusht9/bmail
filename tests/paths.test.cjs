const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { dataDirectory } = require('../engine/paths.cjs');

test('source and bundled runtimes retain their data defaults and honor explicit directories', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bmail-runtime-paths-'));
  try {
    const repository = path.join(root, 'Source with spaces');
    const sourceEngine = path.join(repository, 'engine');
    const bundle = path.join(root, 'Installed app', 'engine');
    const configured = path.join(root, 'Account data');
    fs.mkdirSync(sourceEngine, { recursive: true });
    fs.mkdirSync(bundle, { recursive: true });
    fs.writeFileSync(path.join(repository, 'package.json'), '{}');
    fs.writeFileSync(path.join(bundle, 'package.json'), '{}');

    assert.equal(dataDirectory(sourceEngine, ''), repository);
    assert.equal(dataDirectory(bundle, ''), bundle);
    assert.equal(dataDirectory(sourceEngine, configured), configured);
    assert.equal(dataDirectory(bundle, configured), configured);

    if (process.platform === 'win32') {
      for (const engine of [sourceEngine, bundle]) {
        const script = path.join(engine, 'Backup-Paths.ps1');
        fs.copyFileSync(path.resolve('engine/Backup-Paths.ps1'), script);
        fs.copyFileSync(path.resolve('engine/Data-Directory.ps1'), path.join(engine, 'Data-Directory.ps1'));
        for (const override of ['', configured]) {
          const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command',
            '. $env:BMAIL_PATHS_SCRIPT; Write-Output $dataDirectory',
          ], {
            env: { ...process.env, BMAIL_PATHS_SCRIPT: script, MAIL_VAULT_DATA_DIR: override },
            encoding: 'utf8', windowsHide: true, timeout: 10000,
          });
          assert.equal(result.status, 0, result.stderr);
          assert.equal(result.stdout.trim(), dataDirectory(engine, override), 'PowerShell and Node must use the same data directory');
        }
      }
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
