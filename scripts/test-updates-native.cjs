// Requires a signed release:build first. Uses a separate app data folder and a
// loopback-only update feed; no downloaded fixture can pass signature checks.
const { chromium } = require('playwright-core');
const { execFileSync, spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');

(async () => {
  const config = require('../src-tauri/tauri.conf.json');
  const signature = fs.readFileSync(path.resolve(`.tools/ota-release/Bmail_${config.version}_x64-setup.exe.sig`), 'utf8').trim();
  const testRoot = fs.mkdtempSync(path.resolve('.tools/ota-smoke-'));
  const dataRoot = path.join(testRoot, 'data');
  assert.ok(!fs.existsSync(dataRoot), 'Refusing to overwrite an existing OTA smoke profile.');
  let available = true;
  const server = http.createServer((request, response) => {
    if (request.url === '/latest.json') {
      if (!available) { response.writeHead(204).end(); return; }
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ version: config.version, notes: 'Local native OTA fixture', platforms: { 'windows-x86_64': {
        signature, url: `http://127.0.0.1:${server.address().port}/tampered.exe`,
      } } }));
    } else {
      response.end('This is deliberately not the signed installer.');
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const overlay = path.resolve('.tools/ota-native-test.conf.json');
  fs.writeFileSync(overlay, JSON.stringify({ identifier: 'com.bmail.desktop.ota-smoke', version: '0.0.1',
    app: { appDirectoriesOverride: dataRoot },
    bundle: { createUpdaterArtifacts: false },
    plugins: { updater: { ...config.plugins.updater, endpoints: [`http://127.0.0.1:${server.address().port}/latest.json`],
      dangerousInsecureTransportProtocol: true } },
  }));
  const webProfile = path.join(testRoot, 'web');
  fs.mkdirSync(webProfile);
  let child;
  let browser;
  try {
    execFileSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm.cmd run tauri -- build --no-bundle --config .tools/ota-native-test.conf.json'],
      { stdio: 'inherit', windowsHide: true });
    child = spawn(path.resolve('src-tauri/target/release/bmail.exe'), [], { cwd: webProfile, windowsHide: true, stdio: 'ignore',
      env: { ...process.env, WEBVIEW2_USER_DATA_FOLDER: path.join(webProfile, 'webview'),
        WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=19338' } });
    let ready = false;
    for (let i = 0; i < 60; i++) {
      try { if ((await fetch('http://127.0.0.1:19338/json/version')).ok) { ready = true; break; } } catch {}
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    assert.ok(ready, 'Native OTA test app did not start');
    browser = await chromium.connectOverCDP('http://127.0.0.1:19338');
    const page = browser.contexts().flatMap(context => context.pages())[0];
    assert.ok(page);
    await page.getByText(`Bmail ${config.version} is available.`, { exact: true }).waitFor();
    const info = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('check_update'));
    assert.equal(info.currentVersion, '0.0.1');
    assert.equal(info.version, config.version);

    // A different account's scheduled backup must also prevent installation.
    const otherAccount = path.join(dataRoot, 'accounts/other@example.com');
    fs.mkdirSync(path.join(otherAccount, 'backups'), { recursive: true });
    fs.writeFileSync(path.join(otherAccount, 'backup-config.json'), JSON.stringify({ user: 'other@example.com', backupDirectory: 'backups' }));
    const lock = path.join(otherAccount, 'backups/.backup.lock');
    fs.writeFileSync(lock, JSON.stringify({ pid: process.pid }));
    await page.getByRole('button', { name: 'Install and restart', exact: true }).click();
    await page.getByText(/Stop or finish all account backups/).waitFor();
    fs.unlinkSync(lock);
    await page.getByRole('button', { name: 'Install and restart', exact: true }).click();
    await page.getByText(/Update could not be installed:.*(signature|Signature|verify|Verify)/).waitFor();
    assert.equal(child.exitCode, null, 'Signature rejection must leave the app running');
    assert.ok(fs.existsSync(path.join(otherAccount, 'backup-config.json')));
    available = false;
    await page.getByRole('button', { name: 'Check for updates', exact: true }).click();
    await page.getByText('Bmail is up to date.', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Install and restart', exact: true }).count(), 0);
    console.log('Native OTA: Rust feed check, cross-account backup blocking, tampered installer rejection, app/data preservation, and HTTP 204 recovery passed.');
  } finally {
    if (child && child.exitCode === null) {
      const exited = new Promise(resolve => child.once('exit', resolve));
      // Kill the owned WebView2 descendants as well; killing only the app can
      // leave its web profile open in orphaned renderer processes on Windows.
      spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      await exited;
    }
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(webProfile, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
    // This exact isolated test folder was checked absent before the test.
    fs.rmSync(dataRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
    fs.rmdirSync(testRoot);
    fs.unlinkSync(overlay);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
