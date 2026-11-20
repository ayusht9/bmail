const { chromium } = require('playwright-core');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { digest } = require('../engine/backup.cjs');

(async () => {
  const profile = path.join(process.env.LOCALAPPDATA, 'Bmail Lifecycle Smoke');
  assert.ok(!fs.existsSync(profile), 'Refusing to overwrite an existing lifecycle test profile.');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'bmail-lifecycle-'));
  const account = 'fixture@example.test';
  const accountRoot = path.join(profile, 'accounts', account);
  fs.mkdirSync(accountRoot, { recursive: true });
  fs.writeFileSync(path.join(profile, 'app-settings.json'), JSON.stringify({ activeAccount: account }));
  fs.writeFileSync(path.join(accountRoot, 'backup-config.json'), JSON.stringify({ user: account, host: 'imap.example.test', port: 993, backupDirectory: 'backups' }));
  const backupRoot = path.join(accountRoot, 'backups');
  fs.mkdirSync(backupRoot);
  const key = digest(Buffer.from('INBOX')) + '-1';
  const content = Buffer.from('Subject: Local fixture\r\nFrom: fixture@example.test\r\n\r\nSaved message');
  fs.writeFileSync(path.join(backupRoot, 'local.eml'), content);
  fs.writeFileSync(path.join(backupRoot, 'manifest.json'), JSON.stringify({ user: account, host: 'imap.example.test', folders: { [key]: { name: 'INBOX', messages: { 1: { file: 'local.eml', subject: 'Local fixture', sender: account, sentAt: '2026-11-18T00:00:00Z', bytes: content.length, sha256: digest(content), complete: true } } } } }));
  const messages = Object.fromEntries(Array.from({ length: 123 }, (_, index) => [index + 1, { uid: index + 1, subject: `Server fixture ${index + 1}`, sender: account, sentAt: '2026-11-18T00:00:00Z', bytes: 100 }]));
  fs.writeFileSync(path.join(backupRoot, 'mail-index.json'), JSON.stringify({ checkedAt: new Date().toISOString(), folders: { [key]: { name: 'INBOX', uidValidity: '1', newUids: [1, 123], messages } } }));
  let child;
  let browser;
  let mainHandle = 0;
  const inspect = (action = 'inspect') => {
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
      path.resolve('scripts/inspect-test-window.ps1'), '-TestProcessId', String(child.pid), '-MainHandle', String(mainHandle), '-Action', action,
    ], { encoding: 'utf8', windowsHide: true, timeout: 15000 });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const snapshot = JSON.parse(result.stdout);
    mainHandle = snapshot.main;
    return snapshot;
  };
  async function launch() {
    child = spawn(path.resolve('src-tauri/target/debug/bmail.exe'), [], {
      cwd: temporary, windowsHide: true, stdio: 'ignore',
      env: { ...process.env, WEBVIEW2_USER_DATA_FOLDER: path.join(temporary, 'webview'), WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9340' },
    });
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      try { if ((await fetch('http://127.0.0.1:9340/json/version')).ok) { ready = true; break; } } catch {}
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    assert.ok(ready, 'The native fixture did not start.');
    browser = await chromium.connectOverCDP('http://127.0.0.1:9340');
    let page;
    for (let attempt = 0; attempt < 60; attempt++) {
      page = browser.contexts().flatMap(context => context.pages()).find(candidate => !candidate.url().includes('splash.html') && candidate.url().includes('tauri'));
      if (page) break;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    assert.ok(page, 'The main WebView did not open.');
    await page.locator('.app-toolbar').waitFor();
    // Wait for readiness IPC as well as DOM rendering before inspecting windows.
    await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('finish_startup'));
    return page;
  }
  async function waitForExit() {
    for (let attempt = 0; attempt < 60 && child.exitCode === null; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(child.exitCode, 0, 'Quit-on-close must exit the native process.');
    await browser.close();
    browser = null;
  }
  try {
    let page = await launch();
    const initial = inspect();
    assert.ok(initial.visible);
    assert.ok(initial.tray);
    assert.equal(initial.splash, false, 'The splash is removed after startup.');
    await page.waitForFunction(() => document.querySelector('.app-logo')?.naturalWidth > 0);
    assert.equal((await page.locator('.app-logo').getAttribute('src')).startsWith('data:'), false);
    const firstPage = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('get_mail_page', { folder: null, page: 1, pageSize: 50, sortColumn: 'subject', sortDirection: 'asc' }));
    assert.equal(firstPage.total, 123);
    assert.equal(firstPage.rows.length, 50);
    assert.ok(firstPage.rows.some(row => row.backedUp && row.isNew), 'New mail and backup state can overlap.');
    const lastPage = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('get_mail_page', { folder: null, page: 3, pageSize: 50, sortColumn: 'subject', sortDirection: 'asc' }));
    assert.equal(lastPage.rows.length, 23);
    await page.getByRole('button', { name: 'Maximize or restore window', exact: true }).click();
    assert.equal(await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('plugin:window|is_maximized', { label: 'main' })), true);
    await page.getByRole('button', { name: 'Maximize or restore window', exact: true }).click();
    await page.getByRole('button', { name: 'Minimize window', exact: true }).click();
    assert.equal(await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('plugin:window|is_minimized', { label: 'main' })), true);
    assert.equal(inspect('restore').visible, true);
    await page.evaluate(account => window.__TAURI_INTERNALS__.invoke('set_mail_badge', { account, count: 42 }), account);
    assert.match(inspect().title, /42 new emails/);
    await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('set_mail_badge', { account: 'previous@example.test', count: 99 }));
    assert.match(inspect().title, /42 new emails/, 'A stale account cannot overwrite the current total.');
    await page.getByRole('button', { name: 'Close window', exact: true }).click();
    assert.equal(inspect().visible, false, 'The combined header close control hides the window in the tray.');
    assert.equal(child.exitCode, null, 'The process stays alive in the tray.');
    assert.equal(inspect('restore').visible, true, 'A tray click restores the window.');
    await page.getByRole('tab', { name: 'Preferences', exact: true }).click();
    await page.getByLabel('When I close Bmail', { exact: true }).selectOption('quit');
    await page.waitForFunction(() => document.querySelector('#close-behavior')?.value === 'quit' && !document.querySelector('#close-behavior').disabled);
    assert.equal(JSON.parse(fs.readFileSync(path.join(profile, 'desktop-settings.json'))).closeToTray, false);
    inspect('close');
    await waitForExit();
    mainHandle = 0;
    page = await launch();
    const preferences = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('get_desktop_preferences'));
    assert.equal(preferences.closeToTray, false, 'The close preference survives restart.');
    inspect('close');
    await waitForExit();
    console.log('Native splash readiness, current-account counts, close-to-tray, tray restore, quit-on-close, and preference persistence passed without mailbox connections.');
  } finally {
    await browser?.close().catch(() => {});
    if (child && child.exitCode === null) {
      child.kill();
      await new Promise(resolve => child.once('exit', resolve));
    }
    // These exact directories were created above after checking for conflicts.
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
    fs.rmSync(temporary, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
