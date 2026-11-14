const { chromium } = require('playwright-core');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
(async () => {
  const profile = path.join(process.env.LOCALAPPDATA, 'in.co.integramicro.mail-vault.setup-smoke');
  assert.ok(!fs.existsSync(profile), 'Isolated test profile already exists; refusing to overwrite it.');
  const webProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'mail-vault-ipc-web-'));
  let child;
  let browser;
  try {
    child = spawn(path.resolve('src-tauri/target/release/mail-vault.exe'), [], {
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
    await page.getByRole('button', { name: /Update app password/ }).waitFor();
    const dashboard = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('get_dashboard'));
    assert.equal(dashboard.user, 'fixture@gmail.com');
    assert.equal(dashboard.credentialReady, true);
    assert.equal(dashboard.port, 993);
    assert.ok(fs.existsSync(path.join(profile, '.private/zoho-credential.xml')));
    console.log('Actual app form -> Rust IPC -> windowless PowerShell -> DPAPI -> refreshed dashboard passed with grouped Gmail app password.');
  } finally {
    if (browser) await browser.close();
    if (child && child.exitCode === null) { const stopped = new Promise(resolve => child.once('exit', resolve)); child.kill(); await stopped; }
    // Only the dedicated, known test identifier is removed; real app data is untouched.
    assert.equal(path.basename(profile), 'in.co.integramicro.mail-vault.setup-smoke');
    await fs.promises.rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    await fs.promises.rm(webProfile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
})().catch(error => { console.error(error); process.exit(1); });
