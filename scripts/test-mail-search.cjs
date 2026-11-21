const { chromium } = require('playwright-core');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { metadataPage } = require('../engine/mail-metadata.cjs');

(async () => {
  const root = path.resolve(__dirname, '..');
  const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'bmail-search-ui-'));
  const rows = Array.from({ length: 90 }, (_, i) => ({ id: String(i), subject: `Invoice ${i}`, sender: i % 2 ? 'Alice@example.test' : 'Bob@example.test', folder: i % 3 ? 'INBOX' : 'Sent', backedUp: i % 4 === 0, sentAt: new Date(2026, 10, i % 3 + 1, 12).toISOString() }));
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname === '/') {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end('<!doctype html><html><head><link rel="stylesheet" href="/src/style.css"></head><body><button id="open">Search</button></body></html>'); return;
    }
    if (!/^\/src\/[a-z-]+\.(js|css)$/.test(url.pathname)) { response.writeHead(404).end(); return; }
    response.setHeader('Content-Type', url.pathname.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/css; charset=utf-8');
    fs.createReadStream(path.join(root, url.pathname)).on('error', () => response.end()).pipe(response);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const page = await browser.newPage({ viewport: { width: 1120, height: 780 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const requests = [];
    await page.exposeFunction('searchMailFixture', async options => {
      requests.push(options);
      if (options.query === 'slow') await new Promise(resolve => setTimeout(resolve, 500));
      return metadataPage(cache, '1', rows, options);
    });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.evaluate(async () => {
      const { createUniversalSearch } = await import('/src/universal-search.js');
      const escape = text => String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
      window.fixtureQueries = [];
      const search = createUniversalSearch({ invoke: (name, args) => { window.fixtureQueries.push(args.query); return window.searchMailFixture(args); }, escape, navigate: () => {}, openMail: row => { window.openedMail = row; }, account: () => 'fixture@example.test', unavailable: () => false,
        folders: () => ['INBOX', 'Sent', ' Sent ', '<img src=x onerror="window.injected=true">'] });
      document.querySelector('#open').onclick = search.open;
    });
    await page.click('#open');
    assert.equal(await page.locator('.universal-search footer').count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Close search', exact: true }).innerText(), '');
    const searchStyle = await page.locator('#universal-search-input').evaluate(input => ({ border: getComputedStyle(input).borderWidth, outline: getComputedStyle(input).outlineStyle, shadow: getComputedStyle(input).boxShadow }));
    assert.deepEqual(searchStyle, { border: '0px', outline: 'none', shadow: 'none' });
    await page.waitForFunction(() => document.querySelectorAll('#mail-sender-options option').length === 2);
    assert.deepEqual(await page.locator('#mail-sender-options option').evaluateAll(options => options.map(option => option.value)), ['Alice@example.test', 'Bob@example.test']);
    await page.click('[data-filter="mails"]');
    await page.getByRole('status').filter({ hasText: '90 matching messages' }).waitFor();
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await page.getByText('Page 2 of 4').waitFor();
    await page.locator('.mail-search-filters summary').click();
    const today = await page.evaluate(() => new Date().toLocaleDateString('en-GB'));
    assert.equal(await page.locator('[name=dateFrom]').inputValue(), '');
    assert.equal(await page.locator('[name=dateTo]').inputValue(), '');
    assert.equal(await page.locator('[name=dateFrom]').getAttribute('placeholder'), today);
    assert.equal(await page.locator('[name=dateTo]').getAttribute('placeholder'), today);
    assert.equal(await page.locator('.mail-date-field > span').first().isVisible(), true);
    await page.getByLabel('Folder', { exact: true }).selectOption({ value: ' Sent ' });
    await page.getByRole('status').filter({ hasText: 'No matches' }).waitFor();
    assert.equal(requests.at(-1).folder, ' Sent ');
    await page.getByLabel('Folder', { exact: true }).selectOption('');
    await page.getByRole('status').filter({ hasText: '90 matching messages' }).waitFor();
    await page.getByLabel('Sender', { exact: true }).fill('Alice@example.test');
    await page.getByRole('status').filter({ hasText: '45 matching messages' }).waitFor();
    await page.getByText('Page 1 of 2').waitFor();
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await page.getByText('Page 2 of 2').waitFor();
    assert.equal(requests.at(-1).filters.sender, 'Alice@example.test');
    await page.getByLabel('Folder', { exact: true }).selectOption('INBOX');
    await page.getByRole('status').filter({ hasText: '30 matching messages' }).waitFor();
    await page.getByLabel('Sent from', { exact: true }).fill('2026-11-02');
    await page.getByLabel('Sent through', { exact: true }).fill('2026-11-02');
    await page.getByRole('status').filter({ hasText: '15 matching messages' }).waitFor();
    await page.getByLabel('Backup status', { exact: true }).selectOption('saved');
    await page.getByRole('status').filter({ hasText: 'No matches' }).waitFor();
    await page.getByLabel('Backup status', { exact: true }).selectOption('missing');
    await page.getByRole('status').filter({ hasText: '15 matching messages' }).waitFor();
    await page.getByLabel('Sender', { exact: true }).press('ArrowDown');
    assert.equal(await page.locator(':focus').getAttribute('name'), 'sender');
    await page.getByLabel('Sent from', { exact: true }).fill('2026-11-03');
    await page.getByRole('status').filter({ hasText: 'start date' }).waitFor();
    assert.equal(await page.locator('[data-result]').count(), 0);
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await page.getByRole('status').filter({ hasText: '90 matching messages' }).waitFor();
    assert.equal(await page.locator('[data-filter-count]').textContent(), '');
    assert.equal(await page.locator('.mail-date-field > span').first().isVisible(), true);
    await page.click('[data-filter="settings"]');
    assert.equal(await page.locator('.mail-search-filters').isVisible(), false);
    await page.click('[data-filter="mails"]');
    await page.locator('#universal-search-input').fill('slow');
    await page.waitForFunction(() => window.fixtureQueries.includes('slow')); 
    await page.locator('#universal-search-input').fill('invoice 89');
    await page.locator('#universal-search-input').press('Enter');
    assert.equal(await page.evaluate(() => Boolean(window.openedMail)), false);
    await page.getByRole('status').filter({ hasText: '1 matching message' }).waitFor();
    await page.waitForTimeout(550);
    assert.equal(await page.locator('[data-result]').count(), 1);
    assert.ok((await page.locator('[data-result]').textContent()).includes('Invoice 89'));
    await page.setViewportSize({ width: 390, height: 700 });
    assert.equal(await page.evaluate(() => document.querySelector('dialog').scrollWidth > document.querySelector('dialog').clientWidth), false);
    await page.setViewportSize({ width: 1120, height: 780 });
    fs.mkdirSync(path.join(root, '.cache'), { recursive: true });
    await page.screenshot({ path: path.join(root, '.cache', 'mail-search-filters.png') });
    await page.locator('#universal-search-input').press('Enter');
    await page.waitForFunction(() => window.openedMail?.id === '89');
    assert.equal(await page.evaluate(() => Boolean(window.injected)), false);
    assert.deepEqual(errors, []);
    console.log('Mail search UI passed: SQLite queries, combined filters, pagination, reset, date validation, keyboard input, stale responses, and narrow layout.');
  } finally {
    await browser?.close();
    server.close();
    fs.rmSync(cache, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
