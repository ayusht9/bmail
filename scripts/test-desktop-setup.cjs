const { chromium } = require('playwright-core');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
(async () => {
  const profile = path.join(process.env.LOCALAPPDATA, 'Bmail Setup Smoke');
  assert.ok(!fs.existsSync(profile), 'Isolated test profile already exists; refusing to overwrite it.');
  const webProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'mail-vault-ipc-web-'));
  let child;
  let browser;
  try {
    child = spawn(path.resolve('src-tauri/target/release/bmail.exe'), [], {
      cwd: webProfile, windowsHide: true, stdio: 'ignore', env: { ...process.env,
        WEBVIEW2_USER_DATA_FOLDER: path.join(webProfile, 'webview'),
        WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9338',
      },
    });
    let ready = false;
    for (let i = 0; i < 60; i++) {
      try { if ((await fetch('http://127.0.0.1:9338/json/version')).ok) { ready = true; break; } } catch {}
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    assert.ok(ready, 'Native app did not start');
    browser = await chromium.connectOverCDP('http://127.0.0.1:9338');
    let pages = [];
    for (let i = 0; i < 20; i++) {
      pages = browser.contexts().flatMap(context => context.pages());
      if (pages.length) break;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    const page = pages.find(p => p.url().includes('tauri')) || pages[0];
    assert.ok(page);
    await page.getByRole('button', { name: 'Set up mailbox', exact: true }).first().click();
    assert.equal(await page.getByLabel('TLS port', { exact: true }).inputValue(), '993');
    assert.equal(await page.getByLabel('TLS port', { exact: true }).getAttribute('readonly'), '');
    const invalid = await page.evaluate(async () => {
      try { await window.__TAURI_INTERNALS__.invoke('configure_mailbox', { settings: {
        user: 'fixture@gmail.com', host: 'imap.gmail.com', port: 25, password: 'abcd efgh ijkl mnop',
      } }); } catch (error) { return String(error); }
    });
    assert.match(invalid, /Gmail requires TLS port 993/);
    await page.getByLabel('Email address', { exact: true }).fill('fixture@gmail.com');
    await page.getByLabel('Application-specific password', { exact: true }).fill('abcd efgh ijkl mnop');
    await page.getByRole('button', { name: 'Save mailbox', exact: true }).click();
    await page.getByRole('button', { name: 'Account settings', exact: true }).waitFor();
    const dashboard = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('get_dashboard'));
    assert.equal(dashboard.user, 'fixture@gmail.com');
    assert.equal(dashboard.credentialReady, true);
    assert.equal(dashboard.port, 993);
    const accountRoot = path.join(profile, 'accounts/fixture@gmail.com');
    assert.ok(fs.existsSync(path.join(accountRoot, '.private/zoho-credential.xml')));
    console.log('Actual app form -> Rust IPC -> windowless PowerShell -> DPAPI -> refreshed dashboard passed with grouped Gmail app password.');
    const backupRoot = path.join(accountRoot, 'backups');
    fs.mkdirSync(backupRoot, { recursive: true });
    fs.writeFileSync(path.join(backupRoot, 'mailboxes.json'), JSON.stringify({ folders: ['INBOX', 'Sent'], updatedAt: new Date().toISOString() }));
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#folder-choices')?.textContent.includes('Sent'));
    await page.getByRole('button', { name: 'Choose what to back up', exact: true }).click();
    await page.getByLabel('All available folders', { exact: true }).uncheck();
    await page.getByLabel('INBOX', { exact: true }).check();
    await page.getByLabel('Received from', { exact: true }).fill('2026-01-01');
    await page.getByLabel('Received through', { exact: true }).fill('2026-11-15');
    await page.getByLabel('Maximum new emails per run', { exact: true }).fill('25');
    await page.getByRole('button', { name: 'Save selection', exact: true }).click();
    await page.locator('#selection-dialog').waitFor({ state: 'hidden' });
    const selected = JSON.parse(fs.readFileSync(path.join(accountRoot, 'backup-config.json'), 'utf8').replace(/^\uFEFF/, '')).backupOptions;
    const { advanced, ...basicSelection } = selected;
    assert.deepEqual(basicSelection, { folders: ['INBOX'], dateFrom: '2026-01-01', dateTo: '2026-11-15', maxMessages: 25 });
    assert.equal(advanced.retryAttempts, 3);
    assert.equal(advanced.verifyAfterBackup, true);
    const progress = { runId: 'isolated-progress-test', pid: process.pid, state: 'running', phase: 'downloading',
      startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), totalMessages: 100, processedMessages: 20,
      downloaded: 10, plannedDownloads: 25, savedBytes: 1000000, transferredBytes: 1000000, elapsedSeconds: 60,
      etaSeconds: 300, totalFolders: 2, completedFolders: 0, currentFolder: 'INBOX', bytesPerSecond: 1000,
    };
    const publish = (state, phase = state) => {
      Object.assign(progress, { state, phase, updatedAt: new Date().toISOString() });
      const temporary = path.join(backupRoot, 'progress.test.pending');
      fs.writeFileSync(temporary, JSON.stringify(progress));
      fs.renameSync(temporary, path.join(backupRoot, 'progress.json'));
    };
    fs.writeFileSync(path.join(backupRoot, '.backup.lock'), JSON.stringify({ pid: process.pid }));
    publish('running', 'downloading');
    await page.getByRole('button', { name: 'Pause', exact: true }).waitFor();
    assert.equal(await page.getByRole('progressbar', { name: 'Backup progress' }).getAttribute('value'), '20');
    await page.screenshot({ path: '.tools/bmail-progress.png', fullPage: true });
    const duplicate = await page.evaluate(async () => {
      try { await window.__TAURI_INTERNALS__.invoke('start_backup'); } catch (error) { return String(error); }
    });
    assert.match(duplicate, /already running/);
    async function expectControl(command) {
      for (let i = 0; i < 100; i++) {
        try { if (JSON.parse(fs.readFileSync(path.join(backupRoot, 'control.json'))).command === command) return; } catch {}
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      assert.fail(`Native ${command} command was not saved`);
    }
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await expectControl('pause');
    publish('paused');
    await page.getByRole('button', { name: 'Resume', exact: true }).click();
    await expectControl('resume');
    publish('running', 'downloading');
    await page.getByRole('button', { name: 'Pause', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Stop after this email', exact: true }).click();
    await expectControl('stop');
    publish('stopping');
    await page.getByRole('button', { name: 'Cancel now', exact: true }).click();
    await expectControl('cancel');
    publish('cancelled');
    fs.unlinkSync(path.join(backupRoot, '.backup.lock'));
    await page.getByRole('heading', { name: 'Backup cancelled', level: 2 }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Back up now', exact: true }).isEnabled(), true);
    console.log('Native scope save, automatic progress, duplicate-run protection, pause, resume, stop, and cancel controls passed without connecting to a real mailbox.');
    fs.writeFileSync(path.join(backupRoot, 'manifest.json'), JSON.stringify({ user: 'fixture@gmail.com', host: 'imap.gmail.com', version: 1,
      folders: { inbox: { name: 'INBOX', messages: { 1: { file: 'preserved.eml', bytes: 4 } } } } }));
    fs.writeFileSync(path.join(backupRoot, 'preserved.eml'), 'mail');
    await page.getByRole('button', { name: 'Add account', exact: true }).click();
    assert.equal(await page.getByLabel('Email address', { exact: true }).inputValue(), '');
    await page.getByLabel('Email address', { exact: true }).fill('second@example.com');
    await page.getByLabel('Application-specific password', { exact: true }).fill('abcd efgh ijkl mnop');
    await page.getByRole('button', { name: 'Save mailbox', exact: true }).click();
    await page.locator('#mailbox-dialog').waitFor({ state: 'hidden' });
    assert.ok(fs.existsSync(path.join(profile, 'accounts/second@example.com/.private/zoho-credential.xml')));
    let active = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('get_dashboard'));
    assert.equal(active.user, 'second@example.com');
    assert.equal(active.totalMessages, 0);
    assert.deepEqual(active.accounts, ['fixture@gmail.com', 'second@example.com']);
    await page.getByLabel('Mailbox account', { exact: true }).selectOption('fixture@gmail.com');
    await page.waitForFunction(() => document.querySelector('.workspace-heading p')?.textContent === 'fixture@gmail.com');
    active = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('get_dashboard'));
    assert.equal(active.user, 'fixture@gmail.com');
    assert.equal(active.totalMessages, 1);
    assert.deepEqual(active.backupOptions, selected);
    assert.equal(fs.readFileSync(path.join(backupRoot, 'preserved.eml'), 'utf8'), 'mail');
    console.log('Separate account folders, credentials, selections and saved-message counts passed through the native account selector.');
  } finally {
    if (browser) await browser.close();
    if (child && child.exitCode === null) { const stopped = new Promise(resolve => child.once('exit', resolve)); child.kill(); await stopped; }
    // Only the dedicated, known test identifier is removed; real app data is untouched.
    assert.equal(path.basename(profile), 'Bmail Setup Smoke');
    await fs.promises.rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    await fs.promises.rm(webProfile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
})().catch(error => { console.error(error); process.exit(1); });
