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
      window.calls = [];
      window.failCheck = false;
      window.data = { user: 'fixture@example.com', accounts: ['fixture@example.com'], host: 'imap.gmail.com', port: 993,
        credentialReady: true, hasManifest: true, backupRunning: false, backupOptions: { folders: [] }, folderCount: 1,
        localStats: { messages: 3, bytes: 1048576, folders: [{ name: 'INBOX', messages: 3 }], recent: [
          { subject: '<img src=x onerror="window.injected=true">', sender: 'fixture@example.com', folder: 'INBOX', backedUpAt: '2026-11-15T00:00:00Z' },
        ] }, lastRun: { success: true, downloaded: 1, finishedAt: '2026-11-15T00:00:00Z' } };
      window.__TAURI_INTERNALS__ = { invoke: async (name, args) => {
        window.calls.push(name);
        if (name === 'get_dashboard') return structuredClone(window.data);
        if (name === 'run_action') {
          if (args.action !== 'stats') throw 'Unexpected action';
          if (window.failCheck) throw 'Connection failed';
          window.data.mailboxStatus = { complete: true, checkedAt: '2026-11-15T01:00:00Z', previousCheckedAt: '2026-11-15T00:00:00Z',
            lastFullBackupAt: '2026-11-15T01:00:00Z', savedMessages: 3, totalServerMessages: 3, missingMessages: 0, newMessages: 1,
            folders: [{ name: 'INBOX', serverMessages: 3, missingMessages: 0 }] };
          return 'Mailbox checked';
        }
        throw 'Unexpected IPC command';
      } };
    });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const panel = page.getByRole('region', { name: 'Backup statistics' });
    await panel.getByRole('heading', { name: 'Full backup not checked yet' }).waitFor();
    assert.equal(await panel.getByText('1.0 MB', { exact: true }).count(), 1);
    await page.getByRole('button', { name: 'Check mailbox', exact: true }).click();
    await panel.getByRole('heading', { name: 'Full mailbox backed up at last check' }).waitFor();
    assert.equal(await panel.getByRole('progressbar').getAttribute('value'), '100');
    const recent = page.getByRole('region', { name: 'Recently saved mail' });
    assert.match(await recent.textContent(), /<img/);
    assert.equal(await page.evaluate(() => window.injected), undefined);
    await page.getByRole('navigation', { name: 'Mailbox folders' }).getByRole('button', { name: 'INBOX 3', exact: true }).click();
    await page.getByRole('heading', { name: 'INBOX', level: 1 }).waitFor();
    await page.getByRole('searchbox', { name: 'Filter folders' }).fill('does-not-exist');
    assert.equal(await page.locator('.folder-table tbody button').count(), 0);
    await page.getByRole('searchbox', { name: 'Filter folders' }).fill('');
    await page.getByRole('heading', { name: 'All folders', level: 1 }).waitFor();
    const filter = page.getByRole('searchbox', { name: 'Filter folders' });
    await filter.fill('in');
    await filter.press('Home');
    await page.evaluate(() => { window.data.localStats.bytes = 2097152; });
    await panel.getByText('2.0 MB', { exact: true }).waitFor();
    await page.keyboard.type('x');
    assert.equal(await filter.inputValue(), 'xin', 'Background refresh preserves the input caret');
    await filter.fill('');
    if (process.env.BMAIL_UI_SCREENSHOT) {
      await page.evaluate(() => {
        window.data.localStats.recent[0].subject = 'Monthly account statement';
        window.data.localStats.recent[0].sender = 'Accounts Team';
        window.data.localStats.folders.push({ name: 'Sent', messages: 0 }, { name: 'Archive', messages: 0 }, { name: 'Receipts', messages: 0 });
        window.data.mailboxStatus.folders.push(...['Sent', 'Archive', 'Receipts'].map(name => ({ name, serverMessages: 0, missingMessages: 0 })));
      });
      await page.getByRole('button', { name: 'Refresh', exact: true }).click();
      await page.getByRole('heading', { name: 'All folders', level: 1 }).click();
      await page.screenshot({ path: process.env.BMAIL_UI_SCREENSHOT });
    }
    await page.evaluate(() => { window.data.mailboxStatus.complete = false; window.data.mailboxStatus.missingMessages = 2; window.data.mailboxStatus.totalServerMessages = 5; });
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await panel.getByRole('heading', { name: 'Mailbox backup is incomplete' }).waitFor();
    assert.equal(await panel.getByRole('progressbar').getAttribute('value'), '60');
    await page.evaluate(() => { window.failCheck = true; });
    await page.getByRole('button', { name: 'Check mailbox', exact: true }).click();
    await page.getByRole('alert').getByText('Connection failed', { exact: true }).waitFor();
    await panel.getByRole('heading', { name: 'Mailbox backup is incomplete' }).waitFor();
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    assert.equal(await page.getByRole('alert').isVisible(), true, 'Failure details survive refresh');
    await page.evaluate(() => { window.failCheck = false; });
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await panel.getByRole('heading', { name: 'Full mailbox backed up at last check' }).waitFor();
    assert.equal(await page.getByRole('alert').count(), 0);
    await page.getByRole('button', { name: 'Backup selection', exact: true }).click();
    await page.getByRole('dialog').waitFor();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByRole('button', { name: 'Activity log', exact: true }).click();
    await page.getByRole('region', { name: 'Activity log' }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Install and restart', exact: true }).count(), 0);
    assert.deepEqual(await page.evaluate(() => [...new Set(window.calls)].sort()), ['get_dashboard', 'run_action']);
    await page.evaluate(() => { window.data.backupRunning = true; });
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await panel.getByRole('heading', { name: 'Backup in progress' }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Check mailbox', exact: true }).isDisabled(), true);
    for (const size of [{ width: 1120, height: 780 }, { width: 760, height: 620 }]) {
      await page.setViewportSize(size);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'No horizontal window overflow');
      assert.equal(await page.getByRole('button', { name: 'Check mailbox', exact: true }).isVisible(), true);
    }
    assert.deepEqual(errors, []);
    console.log('Statistics UI passed: unknown/full/partial coverage, counts/bytes, server-check action, failure recovery, escaped recent mail, backup blocking, and no OTA IPC.');
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
