const { chromium } = require('playwright-core');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const root = path.resolve('dist');
  const server = http.createServer((request, response) => {
    const file = path.resolve(root, '.' + new URL(request.url, 'http://localhost').pathname);
    if (file !== root && !file.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
    const target = file === root ? path.join(root, 'index.html') : file;
    response.setHeader('Content-Type', target.endsWith('.js') ? 'text/javascript' : target.endsWith('.css') ? 'text/css' : 'text/html');
    fs.createReadStream(target).on('error', () => response.writeHead(404).end()).pipe(response);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const page = await browser.newPage({ viewport: { width: 1120, height: 780 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      window.backupActive = false;
      window.offline = false;
      window.__TAURI_INTERNALS__ = {
        transformCallback: () => 1,
        unregisterCallback() {},
        invoke: async (name, args) => {
          if (name === 'get_dashboard') return { user: 'fixture@example.com', accounts: ['fixture@example.com'], host: 'imap.gmail.com', port: 993,
            credentialReady: true, hasManifest: false, backupRunning: window.backupActive, backupOptions: { folders: [] },
            progress: window.backupActive ? { runId: 'ota-ui', state: 'running', phase: 'downloading', totalMessages: 100,
              processedMessages: 20, downloaded: 20, plannedDownloads: 100, totalFolders: 1, completedFolders: 0,
              currentFolder: 'INBOX', transferredBytes: 3000000, bytesPerSecond: 40000, elapsedSeconds: 75, etaSeconds: 300 } : null };
          if (name === 'check_update') {
            if (window.offline) throw 'offline';
            return { configured: true, currentVersion: '0.2.0', version: '0.2.1', notes: '<img src=x onerror="window.injected=true">' };
          }
          if (name === 'install_update') {
            window.installVersion = args.version;
            args.onProgress.onmessage({ downloaded: 5, total: 10 });
            await new Promise(resolve => setTimeout(resolve, 1200));
            throw 'Signature verification failed';
          }
        },
      };
    });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const panel = page.getByRole('region', { name: 'Application updates' });
    await panel.getByText('Bmail 0.2.1 is available.', { exact: true }).waitFor();
    await panel.getByText('Release notes', { exact: true }).click();
    assert.match(await panel.locator('.release-notes').textContent(), /<img/);
    assert.equal(await page.evaluate(() => window.injected), undefined);
    await page.getByRole('button', { name: 'Install and restart', exact: true }).click();
    await panel.getByText('Downloading update: 50%', { exact: true }).waitFor();
    assert.equal(await page.locator('[data-action="backup"]').isDisabled(), true);
    await panel.getByText(/Signature verification failed/).waitFor();
    assert.equal(await page.evaluate(() => window.installVersion), '0.2.1');
    assert.equal(await page.getByRole('button', { name: 'Install and restart', exact: true }).isEnabled(), true);
    await page.evaluate(() => { window.backupActive = true; });
    await page.locator('[data-action="refresh"]').click();
    await page.waitForFunction(() => document.querySelector('[data-action="install-update"]')?.disabled);
    await page.evaluate(() => window.scrollTo(0, 0));
    const pauseBounds = await page.getByRole('button', { name: 'Pause', exact: true }).boundingBox();
    assert.ok(pauseBounds && pauseBounds.y + pauseBounds.height < 780, 'Update controls must keep Pause visible at the default window size');
    await page.evaluate(() => { window.offline = true; });
    await panel.getByRole('button', { name: 'Check for updates', exact: true }).click();
    await panel.getByText(/Could not check for updates/).waitFor();
    assert.deepEqual(errors, []);
    console.log('Update UI: startup check, escaped notes, download progress, disabled backup/install controls, signature failure recovery, and offline retry passed.');
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
