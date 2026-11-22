// Captures the README screenshots from the built UI (run `npm.cmd run build` first).
// The Tauri backend is replaced with fictional data, so no real mailbox or personal
// data is used. Requires Microsoft Edge. Output: docs/images/*.png
const { chromium } = require('playwright-core');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { paginateMail } = require('../engine/mail-page.cjs');

const root = path.resolve('dist');
const out = path.resolve('docs/images');

const day = n => new Date(Date.UTC(2026, 10, 20 - n, 9 + (n * 7) % 9, (n * 13) % 60)).toISOString();
const inbox = [
  ['Your November statement is ready', 'Northwind Bank <statements@northwind.example>', 48_210],
  ['Re: Weekend hiking plans', 'Jamie Lee <jamie@example.net>', 12_640],
  ['Flight confirmation: LHR → SFO', 'Contoso Air <bookings@contoso-air.example>', 96_400],
  ['Invoice #4821 from Fabrikam Studio', 'Fabrikam Studio <billing@fabrikam.example>', 152_330],
  ['Photos from Saturday', 'Priya Shah <priya@example.org>', 4_812_000],
  ['Quarterly planning notes', 'Sam Carter <sam@example.com>', 22_150],
  ['Your package has shipped', 'Tailspin Deliveries <track@tailspin.example>', 31_900],
  ['Library books due next week', 'City Library <notices@library.example>', 9_870],
  ['Re: Apartment lease renewal', 'Harbor Homes <leasing@harbor.example>', 64_300],
  ['Dinner on Friday?', 'Chris Ng <chris@example.net>', 6_210],
  ['Conference schedule and venue map', 'DevSummit <hello@devsummit.example>', 1_204_500],
  ['Password changed successfully', 'Woodgrove Accounts <no-reply@woodgrove.example>', 14_020],
];
const mail = inbox.map(([subject, sender, bytes], i) => ({
  file: `emails/INBOX/${i}.eml`, subject, sender, folder: 'INBOX', sentAt: day(i), bytes,
  backedUp: i !== 0, backedUpAt: i !== 0 ? day(i) : null,
}));
['Re: Quarterly planning notes', 'Trip itinerary', 'Signed lease attached'].forEach((subject, i) =>
  mail.push({ file: `emails/Sent/${i}.eml`, subject, sender: 'Alex Morgan <alex@example.com>', folder: 'Sent', sentAt: day(i + 1), bytes: 18_000 + i * 9000, backedUp: true, backedUpAt: day(i) }));
const folders = [['INBOX', 12], ['Sent', 3], ['Archive', 38], ['Receipts', 21], ['Newsletters', 64], ['Drafts', 2]];

const fixture = {
  data: {
    user: 'alex@example.com', accounts: ['alex@example.com'], host: 'imap.gmail.com', port: 993,
    credentialReady: true, hasManifest: true, backupRunning: false,
    backupOptions: { folders: folders.map(f => f[0]) }, folderCount: folders.length,
    mailboxes: { folders: folders.map(f => f[0]) },
    cloudIcloud: { connected: false, automatic: false, stage: 'disconnected' },
    cloudDropbox: { configured: true, connected: true, automatic: true, stage: 'ready', dropboxAccount: 'alex@example.com', lastSyncedAt: day(0) },
    cloudDrive: { configured: true, connected: false, automatic: false, stage: 'disconnected' },
    localStats: { messages: 140, bytes: 38_400_000, folders: folders.map(([name, messages]) => ({ name, messages })), recent: mail },
    lastRun: { success: true, downloaded: 14, finishedAt: day(0) },
    mailboxStatus: { complete: false, checkedAt: day(0), previousCheckedAt: day(1), lastFullBackupAt: day(0), savedMessages: 139, totalServerMessages: 140, missingMessages: 1, newMessages: 1,
      folders: folders.map(([name, n]) => ({ name, serverMessages: n, missingMessages: name === 'INBOX' ? 1 : 0 })) },
    history: [
      { runId: 'r1', outcome: 'completed', downloaded: 14, startedAt: day(0), finishedAt: day(0), durationSeconds: 48 },
      { runId: 'r2', outcome: 'completed', downloaded: 31, startedAt: day(1), finishedAt: day(1), durationSeconds: 96 },
      { runId: 'r3', outcome: 'completed', downloaded: 9, startedAt: day(2), finishedAt: day(2), durationSeconds: 37 },
      { runId: 'r4', outcome: 'failed', downloaded: 0, startedAt: day(3), finishedAt: day(3), durationSeconds: 12, error: { message: 'The mail server could not be reached.', code: 'NETWORK' } },
      { runId: 'r5', outcome: 'completed', downloaded: 112, startedAt: day(5), finishedAt: day(5), durationSeconds: 214 },
    ],
  },
  schedule: { installed: true, enabled: true, state: 'Ready', nextRunTime: '2026-11-21T02:00:00Z', checkedAt: day(0),
    settings: { enabled: true, frequency: 'daily', time: '02:00', days: [] } },
  message: {
    subject: 'Flight confirmation: LHR → SFO', from: 'Contoso Air <bookings@contoso-air.example>', to: 'alex@example.com', date: day(2), text: '', attachments: [{ name: 'boarding-pass.pdf' }],
    html: `<div style="font-family:Segoe UI,Arial,sans-serif;color:#1d2b36;max-width:560px">
      <h2 style="margin:0 0 8px">You're all set, Alex.</h2>
      <p>Your booking <b>CX7K2P</b> is confirmed. Your boarding pass is attached.</p>
      <table style="border-collapse:collapse;width:100%;margin:12px 0">
        <tr><td style="padding:8px;border:1px solid #dde3e8">Flight</td><td style="padding:8px;border:1px solid #dde3e8">CA 284</td></tr>
        <tr><td style="padding:8px;border:1px solid #dde3e8">Departs</td><td style="padding:8px;border:1px solid #dde3e8">London Heathrow · 24 Nov, 10:35</td></tr>
        <tr><td style="padding:8px;border:1px solid #dde3e8">Arrives</td><td style="padding:8px;border:1px solid #dde3e8">San Francisco · 24 Nov, 13:50</td></tr>
      </table>
      <p>Have a great trip!<br>The Contoso Air team</p></div>`,
  },
};

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const server = http.createServer((request, response) => {
    const file = path.resolve(root, '.' + new URL(request.url, 'http://localhost').pathname);
    if (file !== root && !file.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
    const target = file === root ? path.join(root, 'index.html') : file;
    response.setHeader('Content-Type', target.endsWith('.js') ? 'text/javascript' : target.endsWith('.css') ? 'text/css' : target.endsWith('.svg') ? 'image/svg+xml' : target.endsWith('.png') ? 'image/png' : 'text/html');
    fs.createReadStream(target).on('error', () => response.writeHead(404).end()).pipe(response);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    for (const scheme of ['light', 'dark']) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, colorScheme: scheme, timezoneId: 'Europe/London', locale: 'en-GB' });
      page.on('pageerror', error => console.error('page error:', error.message));
      await page.exposeFunction('fixtureMailPage', (rows, options) => paginateMail(rows, options));
      await page.addInitScript(fx => {
        if (window.top !== window) return;
        localStorage.setItem('bmail-pane-sizes', JSON.stringify({ mailRatio: 0.56 }));
        const data = fx.data; let schedule = fx.schedule;
        data.schedule = schedule; data.scheduleInstalled = true;
        window.__TAURI_INTERNALS__ = { metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } }, invoke: async (name, args) => {
          if (name.startsWith('plugin:')) return;
          switch (name) {
            case 'get_dashboard': return structuredClone(data);
            case 'get_mail_page': return window.fixtureMailPage(data.localStats.recent.filter(m => !args.folder || m.folder === args.folder), args);
            case 'get_saved_mail': return data.localStats.recent.filter(m => m.backedUp && (!args.folder || m.folder === args.folder));
            case 'get_saved_message': return fx.message;
            case 'get_desktop_preferences': return { closeToTray: true, scheduledBackupsEnabled: true, cloudBackupsEnabled: true };
            case 'get_microsoft_sign_in_status': return { available: false };
            case 'manage_schedule': return structuredClone(schedule);
            case 'cloud_dropbox': return { ...data.cloudDropbox };
            case 'cloud_drive': return { ...data.cloudDrive };
            case 'cloud_icloud': return { ...data.cloudIcloud };
            case 'run_action': return args.action === 'new-mail' ? JSON.stringify({ folders: [{ name: 'INBOX', newMessages: 1 }] }) : 'ok';
            default: return;
          }
        } };
      }, fixture);
      await page.goto(url);
      await page.locator('.app-logo').waitFor();
      await page.waitForTimeout(800);
      const tab = async name => { await page.getByRole('tab', { name, exact: true }).click(); await page.getByRole('tabpanel', { name, exact: true }).waitFor(); await page.waitForTimeout(500); };
      const shot = async name => { await page.screenshot({ path: path.join(out, `${name}.png`) }); console.log('saved', name); };

      // Home: open the INBOX and select a message so the reader is visible.
      await page.locator('.folder-row', { hasText: 'INBOX' }).first().click();
      await page.getByText('Flight confirmation: LHR → SFO').first().click();
      await page.getByRole('region', { name: 'Email preview' }).waitFor();
      await page.waitForTimeout(800);
      await shot(scheme === 'light' ? 'home' : 'home-dark');
      if (scheme === 'dark') { await page.close(); continue; }

      await page.keyboard.press('Control+k');
      await page.waitForTimeout(400);
      await page.keyboard.type('invoice');
      await page.waitForTimeout(600);
      await shot('search');
      await page.keyboard.press('Escape');

      for (const [name, file] of [['Backup', 'backup'], ['Scheduler', 'scheduler'], ['Activity', 'activity']]) {
        await tab(name);
        if (name === 'Activity') { await page.locator('.history-list tbody tr').first().locator('td').nth(1).click(); await page.waitForTimeout(400); }
        await shot(file);
      }
      await page.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
