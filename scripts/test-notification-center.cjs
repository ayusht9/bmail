const { chromium } = require('playwright-core');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const root = path.resolve('.');
  const server = http.createServer((request, response) => {
    const name = new URL(request.url, 'http://localhost').pathname;
    if (name === '/') { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><html><head><link rel="stylesheet" href="/src/style.css"></head><body><header class="app-toolbar"><strong>Bmail</strong><div class="toolbar-spacer"></div><div class="navbar-notifications"></div></header><main id="fixture"></main></body></html>'); return; }
    const file = path.resolve(root, '.' + name);
    if (!file.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
    response.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : 'text/css');
    fs.createReadStream(file).on('error', () => response.writeHead(404).end()).pipe(response);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1120, height: 780 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.clock.install();
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.evaluate(async () => {
      const { createNotificationCenter } = await import('/src/notification-center.js');
      window.center = createNotificationCenter({ account: () => 'fixture@example.com', escape: value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;'), date: value => new Date(value).toLocaleString('en-IN'), onChange: () => document.querySelector('.navbar-notifications').innerHTML = center.bell() });
      document.querySelector('#fixture').innerHTML = center.shell(); center.mount();
    });
    await page.evaluate(() => {
      center.syncMail(3); center.syncMail(3); center.handle('notifications-open');
    });
    assert.equal(await page.locator('.notification-item').count(), 1);
    await page.locator('[data-action="notification-read"]').focus();
    await page.evaluate(() => { window.focusedNotification = document.activeElement; center.syncMail(3); });
    assert.equal(await page.evaluate(() => focusedNotification === document.activeElement), true, 'Unchanged polling preserves the focused notification');
    await page.evaluate(() => { center.handle('notifications-read-all'); center.syncMail(3); });
    assert.equal(await page.locator('.notification-count').count(), 0, 'Polling does not make read mail unread again');
    await page.evaluate(() => center.syncMail(0));
    assert.equal(await page.locator('.notification-item').count(), 0, 'Zero new mail clears stale counts from the open panel');
    await page.evaluate(() => {
      center.notify('Backup completed. 12 emails saved.', { level: 'success', key: 'backup:fixture:completed', transient: false });
      center.syncMail(2);
    });
    if (process.env.BMAIL_NOTIFICATION_PREVIEW) {
      await page.screenshot({ path: process.env.BMAIL_NOTIFICATION_PREVIEW, animations: 'disabled' });
      await page.evaluate(() => document.documentElement.dataset.theme = 'dark');
      await page.screenshot({ path: process.env.BMAIL_NOTIFICATION_PREVIEW.replace(/\.png$/, '-dark.png'), animations: 'disabled' });
    }
    await page.evaluate(() => { center.handle('notifications-clear'); center.syncMail(2); center.notify('Backup completed. 12 emails saved.', { key: 'backup:fixture:completed' }); });
    assert.equal(await page.locator('.notification-item').count(), 0, 'Cleared events do not return');
    await page.evaluate(() => { center.handle('notifications-close'); center.notify('First popup'); });
    await page.evaluate(() => window.firstToast = document.querySelector('.toast'));
    await page.clock.fastForward(3000);
    await page.locator('.toast').hover();
    await page.evaluate(() => center.notify('Second popup'));
    assert.equal(await page.evaluate(() => firstToast === document.querySelector('.toast')), true, 'New popups preserve hovered toast nodes');
    await page.clock.fastForward(6000);
    assert.equal(await page.getByText('First popup', { exact: true }).isVisible(), true);
    await page.mouse.move(0, 0);
    await page.clock.fastForward(2100);
    assert.equal(await page.locator('.toast').count(), 0, 'Leaving a toast resumes its remaining time');
    await page.evaluate(() => { center.notify('Repeated popup'); center.notify('Repeated popup'); });
    assert.equal(await page.locator('.toast').count(), 1, 'Identical active popup messages are coalesced');
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); center.notify('Hidden popup'); delete document.hidden; });
    assert.equal(await page.locator('.toast').count(), 0, 'Returning to the app cannot replay background popups');
    assert.deepEqual(errors, []);
    console.log('Notification browser checks passed: current mail state, dismissal, deduplication, hover timing, and background expiry.');
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
