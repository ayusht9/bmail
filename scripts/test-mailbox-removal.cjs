const { chromium } = require('playwright-core');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');

(async () => {
  const profile = path.join(process.env.LOCALAPPDATA, 'Bmail Setup Smoke');
  assert.ok(!fs.existsSync(profile), 'Isolated test profile exists; refusing to overwrite it.');
  const webProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'bmail-removal-web-'));
  const first = 'remove-one@bmail.test';
  const second = 'remove-two@bmail.test';
  const accountRoot = email => path.join(profile, 'accounts', email);
  const endpoint = require('node:net').createServer();
  await new Promise(resolve => endpoint.listen(0, '127.0.0.1', resolve));
  const port = endpoint.address().port;
  await new Promise(resolve => endpoint.close(resolve));
  let child;
  let browser;
  try {
    for (const email of [first, second]) {
      const root = accountRoot(email);
      fs.mkdirSync(path.join(root, '.private'), { recursive: true });
      fs.mkdirSync(path.join(root, 'backups'));
      fs.writeFileSync(path.join(root, 'backup-config.json'), JSON.stringify({ user: email, host: 'imap.example.test', port: 993, backupDirectory: 'backups' }));
      // Pending credentials are cleaned up; no ready credential means no mailbox network requests.
      fs.writeFileSync(path.join(root, '.private/zoho-credential.xml.pending'), 'opaque fixture token');
      fs.writeFileSync(path.join(root, 'backups/preserved.eml'), 'original message bytes');
    }
    fs.writeFileSync(path.join(profile, 'app-settings.json'), JSON.stringify({ activeAccount: first }));
    const backupLock = path.join(accountRoot(first), 'backups/.backup.lock');
    fs.writeFileSync(backupLock, JSON.stringify({ pid: process.pid }));
    child = spawn(path.resolve('src-tauri/target/debug/bmail.exe'), [], {
      windowsHide: true, stdio: 'ignore', env: { ...process.env,
        WEBVIEW2_USER_DATA_FOLDER: path.join(webProfile, 'webview'),
        WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
      },
    });
    let ready = false;
    for (let i = 0; i < 60; i++) {
      try { if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) { ready = true; break; } } catch {}
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    assert.ok(ready, 'Native app did not start');
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    let page;
    for (let i = 0; i < 40; i++) {
      page = browser.contexts().flatMap(context => context.pages()).find(p => p.url().includes('tauri') && !p.url().includes('splash'));
      if (page) break;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    assert.ok(page, 'Native main window was not available');
    await page.locator('#active-account').waitFor();
    const initial = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('get_dashboard'));
    assert.equal(path.resolve(initial.dataDirectory).toLowerCase(), path.resolve(accountRoot(first)).toLowerCase(), 'Refusing to act outside the isolated test account');
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const refused = await page.evaluate(async email => {
      try { await window.__TAURI_INTERNALS__.invoke('remove_mailbox', { email }); return ''; }
      catch (error) { return String(error); }
    }, first);
    assert.match(refused, /Finish or stop/);
    assert.ok(fs.existsSync(backupLock));
    const nonactive = await page.evaluate(async email => {
      try { await window.__TAURI_INTERNALS__.invoke('remove_mailbox', { email }); return ''; }
      catch (error) { return String(error); }
    }, second);
    assert.match(nonactive, /Select that mailbox/);
    fs.unlinkSync(backupLock);
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await page.waitForFunction(() => !document.querySelector('[data-action="remove-mailbox"]')?.disabled);
    assert.equal(await page.locator('.account-heading [data-action="add-account"]').count(), 1);
    assert.equal(await page.locator('.sidebar-heading [data-action="add-account"]').count(), 0);
    await page.locator('[data-action="setup"]').first().click();
    const trash = page.locator('#mailbox-dialog [data-action="remove-mailbox"]');
    assert.equal(await trash.textContent(), '');
    await trash.click();
    const confirmation = page.locator('#remove-mailbox-dialog');
    await confirmation.waitFor();
    assert.equal(await confirmation.locator('strong').textContent(), first);
    assert.match(await confirmation.textContent(), /Local emails will be kept/);
    await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.ok(fs.existsSync(path.join(accountRoot(first), 'backup-config.json')));
    await trash.click();
    await confirmation.getByRole('button', { name: 'Remove mailbox', exact: true }).click();
    await page.waitForFunction(email => document.querySelector('#active-account')?.value === email, second);
    assert.ok(!fs.existsSync(accountRoot(first)));
    assert.ok(fs.existsSync(accountRoot(second)));
    const retained = fs.readdirSync(path.join(profile, 'removed-accounts')).find(name => name.startsWith(first));
    assert.ok(retained);
    const retainedRoot = path.join(profile, 'removed-accounts', retained);
    assert.equal(fs.readFileSync(path.join(retainedRoot, 'backups/preserved.eml'), 'utf8'), 'original message bytes');
    assert.ok(!fs.existsSync(path.join(retainedRoot, '.private')));
    assert.ok(!fs.existsSync(path.join(retainedRoot, 'backups/.backup.lock')));
    assert.equal(JSON.parse(fs.readFileSync(path.join(profile, 'app-settings.json'))).activeAccount, second);
    await page.locator('[data-action="setup"]').first().click();
    await page.locator('#mailbox-dialog [data-action="remove-mailbox"]').click();
    await page.locator('#remove-mailbox-dialog').getByRole('button', { name: 'Remove mailbox', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#active-account')?.textContent.includes('No mailbox configured'));
    assert.equal(JSON.parse(fs.readFileSync(path.join(profile, 'app-settings.json'))).activeAccount, null);
    assert.ok(!fs.existsSync(accountRoot(second)));
    assert.deepEqual(errors, []);
    console.log('Native mailbox removal passed: icon placement, confirmation, cancel, busy protection, account switching, retained mail, cleared credentials, and last-account removal.');
  } finally {
    await browser?.close();
    if (child && child.exitCode === null) { const stopped = new Promise(resolve => child.once('exit', resolve)); child.kill(); await stopped; }
    // These are dedicated test folders; verify their resolved boundaries before recursive cleanup.
    assert.equal(path.resolve(profile), path.resolve(process.env.LOCALAPPDATA, 'Bmail Setup Smoke'));
    assert.equal(path.dirname(path.resolve(webProfile)), path.resolve(os.tmpdir()));
    await fs.promises.rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    await fs.promises.rm(webProfile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
