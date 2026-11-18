const { chromium } = require('playwright-core');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { paginateMail } = require('../engine/mail-page.cjs');

(async () => {
  const root = path.resolve('dist');
  const server = http.createServer((request, response) => {
    const file = path.resolve(root, '.' + new URL(request.url, 'http://localhost').pathname);
    if (file !== root && !file.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
    const target = file === root ? path.join(root, 'index.html') : file;
    response.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; connect-src 'self'");
    response.setHeader('Content-Type', target.endsWith('.js') ? 'text/javascript' : target.endsWith('.css') ? 'text/css' : target.endsWith('.svg') ? 'image/svg+xml' : 'text/html');
    fs.createReadStream(target).on('error', () => response.writeHead(404).end()).pipe(response);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const page = await browser.newPage({ viewport: { width: 1120, height: 780 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.exposeFunction('fixtureMailPage', (rows, options) => paginateMail(rows, options));
    await page.addInitScript(() => {
      if (window.top !== window) return;
      window.calls = []; window.exports = []; window.failExport = false;
      window.dashboardForces = [];
      window.failCheck = false; window.newMailChecks = 0; window.newMailFailure = sessionStorage.getItem('fixture-new-mail-failure') || '';
      window.failSchedule = false;
      window.scheduleState = { installed: false, enabled: false, state: 'Not installed', settings: null, checkedAt: new Date().toISOString() };
      window.data = { user: 'fixture@example.com', accounts: ['fixture@example.com'], host: 'imap.gmail.com', port: 993,
        credentialReady: true, hasManifest: true, backupRunning: false, backupOptions: { folders: ['INBOX'] }, folderCount: 1,
        localStats: { messages: 3, bytes: 1048576, folders: [{ name: 'INBOX', messages: 3 }], recent: [
          { file: 'emails/INBOX/one.eml', subject: '<img src=x onerror="window.injected=true">', sender: 'fixture@example.com', folder: 'INBOX', sentAt: '2020-01-02T00:00:00Z', bytes: 2048, backedUp: true, backedUpAt: '2026-11-15T00:00:00Z' },
        ] }, lastRun: { success: true, downloaded: 1, finishedAt: '2026-11-15T00:00:00Z' } };
      window.__TAURI_INTERNALS__ = { metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } }, invoke: async (name, args) => {
        window.calls.push(name);
        if (name.startsWith('plugin:window|')) return;
        if (name === 'finish_startup') return;
        if (name === 'open_directory') { window.openedDirectory = args.kind; return; }
        if (name === 'get_desktop_preferences') return { closeToTray: sessionStorage.getItem('fixture-close-to-tray') !== 'false' };
        if (name === 'save_desktop_preferences') {
          if (window.failPreferences) throw 'Could not save desktop preferences';
          sessionStorage.setItem('fixture-close-to-tray', String(args.preferences.closeToTray));
          return args.preferences;
        }
        if (name === 'set_mail_badge') { (window.badgeUpdates ||= []).push(args); return; }
        if (name === 'export_mail') { window.exports.push(args); if (window.holdExport) await new Promise(resolve => { window.finishExport = resolve; }); if (window.failExport) throw 'Export failed'; return 'Download saved.'; }
        if (name === 'start_backup') {
          window.data.backupRunning = true;
          window.data.progress = { runId: 'fixture-backup-controls', state: 'running', phase: 'downloading', totalMessages: 4, processedMessages: 1, plannedDownloads: 4, downloaded: 1 };
          return 'Backup started';
        }
        if (name === 'control_backup') {
          (window.controlCommands ||= []).push(args);
          if (window.holdControl) await new Promise(resolve => { window.finishControl = resolve; });
          if (args.command === 'pause') window.data.progress.state = 'paused';
          if (args.command === 'resume') window.data.progress.state = 'running';
          if (['stop', 'cancel'].includes(args.command)) { window.data.backupRunning = false; window.data.progress.state = args.command === 'stop' ? 'stopped' : 'cancelled'; }
          return 'Control applied';
        }
        if (name === 'get_saved_message') { if (window.failReader) throw 'Saved email is unavailable'; window.lastReadFile = args.file; return { subject: 'Preview subject', from: 'Sender <sender@example.com>', to: 'reader@example.com', date: '2026-11-16T09:00:00Z', html: '<p>Hello from the selected email</p><script>window.previewInjected=true</script><img alt="Remote logo" src="https://tracking.invalid/pixel"><img alt="Embedded logo" src="data:image/png;base64,iVBORw0KGgo="><a href="javascript:alert(1)">link</a>', text: '', attachments: [] }; }
        if (name === 'get_mail_page') return window.fixtureMailPage(window.data.localStats.recent.filter(mail => !args.folder || mail.folder === args.folder), args);
        if (name === 'get_dashboard') { window.dashboardForces.push(args?.force); return structuredClone(window.data); }
        if (name === 'manage_schedule') {
          if (window.failSchedule) throw 'Windows scheduler unavailable';
          if (args.action === 'save') window.scheduleState = { installed: true, enabled: args.schedule.enabled, settings: args.schedule,
            state: args.schedule.enabled ? 'Ready' : 'Disabled', nextRunTime: args.schedule.enabled ? '2035-01-01T13:45:00Z' : null, checkedAt: new Date().toISOString() };
          if (args.action === 'remove') window.scheduleState = { ...window.scheduleState, installed: false, enabled: false, state: 'Not installed', settings: { ...window.scheduleState.settings, enabled: false } };
          window.data.schedule = structuredClone(window.scheduleState); window.data.scheduleInstalled = window.scheduleState.installed;
          return structuredClone(window.scheduleState);
        }
        if (name === 'save_backup_options') { window.savedOptions = args.options; window.data.backupOptions = args.options; return 'Backup options saved'; }
        if (name === 'test_notification') return 'Test notification requested';
        if (name === 'run_action') {
          if (args.action === 'new-mail') { window.newMailChecks++; if (window.newMailFailure) throw window.newMailFailure; return JSON.stringify({ folders: [{ name: 'INBOX', newMessages: 2 }, { name: 'Sent', newMessages: 0 }, { name: 'New folder', newMessages: 1 }] }); }
          if (args.action === 'folders') { window.data.mailboxes = { folders: ['INBOX','Sent','Archive','Drafts'] }; return 'Folders loaded'; }
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
    await page.goto(`http://127.0.0.1:${server.address().port}/splash.html`);
    assert.equal(await page.getByRole('heading', { name: 'Bmail', exact: true }).count(), 1);
    assert.equal(await page.locator('.startup-screen img').evaluate(image => image.complete && image.naturalWidth > 0), true);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await page.locator('.startup-progress span').evaluate(element => getComputedStyle(element).animationName), 'none');
    if (process.env.BMAIL_SPLASH_SCREENSHOT) await page.screenshot({ path: process.env.BMAIL_SPLASH_SCREENSHOT });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.locator('.app-logo').waitFor();
    await page.waitForFunction(() => document.querySelector('.app-logo')?.naturalWidth > 0);
    assert.equal((await page.locator('.app-logo').getAttribute('src')).startsWith('data:'), false, 'The header logo is packaged as an asset rather than a blocked data URL');
    assert.equal(await page.getByRole('group', { name: 'Window controls' }).count(), 1);
    await page.getByRole('button', { name: 'Minimize window', exact: true }).click();
    await page.getByRole('button', { name: 'Maximize or restore window', exact: true }).click();
    const tab = name => page.getByRole('tab', { name, exact: true });
    const go = async name => { await tab(name).click(); await page.getByRole('tabpanel', { name, exact: true }).waitFor(); };
    const dismissToasts = async () => {
      while (await page.locator('#toast [data-action="toast-dismiss"]').count()) {
        await page.locator('#toast [data-action="toast-dismiss"]').last().click();
      }
    };
    const refreshLocal = async () => {
      const before = await page.evaluate(() => window.dashboardForces.length);
      await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
      await page.waitForFunction(before => window.dashboardForces.length > before, before);
      await page.waitForFunction(() => !document.querySelector('.mail-pane[aria-busy="true"]'));
    };

    const sidebar = page.getByRole('navigation', { name: 'Mailbox folders' });
    await page.waitForFunction(() => document.querySelector('.statusbar .new-mail-badge'));
    assert.equal(await page.evaluate(() => window.newMailChecks), 1);
    assert.equal(await page.locator('.statusbar .new-mail-badge').textContent(), '3');
    await page.waitForFunction(() => window.badgeUpdates?.at(-1)?.count === 3);
    assert.equal(await page.evaluate(() => window.badgeUpdates.at(-1).account), 'fixture@example.com');
    assert.match(await page.locator('.statusbar .new-mail-badge').getAttribute('aria-label'), /3 new emails/);
    assert.equal(await sidebar.locator('.folder-row[data-folder="INBOX"] .new-mail-badge').count(), 1);
    assert.equal(await sidebar.locator('.folder-row[data-folder="Sent"] .new-mail-badge').count(), 0);
    assert.equal(await sidebar.locator('.folder-row[data-folder="INBOX"] svg[data-folder-icon]').getAttribute('data-folder-icon'), 'inbox');
    assert.equal(await sidebar.locator('.folder-row[data-folder="Sent"] svg[data-folder-icon]').getAttribute('data-folder-icon'), 'sent');
    assert.equal(await page.locator('.folder-table').count(), 0);
    await page.locator('.mail-table tbody tr').first().waitFor();
    for (const selector of ['.mail-table']) {
      assert.equal(await page.locator(`${selector} thead th`).count(), 5);
      assert.equal(await page.locator(selector).getByRole('separator').count(), 5);
      assert.equal(await page.locator(`${selector} tbody tr`).first().locator('td').count(), 5);
      assert.equal(await page.locator(`${selector} td.row-actions .download-icon`).first().isVisible(), true);
    }
    assert.equal(await page.locator('.mail-pane .pane-hint').count(), 0);
    assert.equal(await page.locator('.mail-table thead').getByRole('button', { name: 'Saved', exact: true }).count(), 0);
    assert.match(await page.locator('.mail-table tbody td').nth(3).textContent(), /2020/);
    assert.equal(await page.locator('.mail-table tbody td').nth(4).textContent(), '2.0 KB');
    assert.equal(await page.locator('.mail-table tbody tr.backed-up').count(), 1);

    assert.equal(await page.locator('.status-message').textContent(), '');

    await page.getByRole('searchbox', { name: 'Filter folders' }).fill('INBOX');
    assert.equal(await sidebar.locator('.new-mail-badge').count(), 1);
    await page.getByRole('searchbox', { name: 'Filter folders' }).fill('');
    assert.equal(await page.getByRole('tab').count(), 5);
    assert.deepEqual(await page.getByRole('tab').allTextContents(), ['Home', 'Backup', 'Scheduler', 'Activity', 'Preferences']);
    assert.equal(await page.getByRole('tab', { name: 'History', exact: true }).count(), 0);
    assert.equal(await page.locator('[role="tabpanel"]:not([hidden])').count(), 1);
    assert.equal(await page.locator('.selection-summary,.storage-summary,.inspector').count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Refresh', exact: true }).count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Open backup folder', exact: true }).count(), 0);
    const syncButton = page.locator('.account-heading').getByRole('button', { name: 'Sync', exact: true });
    assert.equal(await syncButton.getAttribute('title'), 'Sync');
    assert.equal(await syncButton.textContent(), '', 'Sync is an icon beside the Account label');
    assert.equal(await syncButton.locator('svg').count(), 1);
    assert.equal(await page.getByRole('button', { name: 'Choose what to back up', exact: true }).count(), 0);
    const recent = page.getByRole('region', { name: 'Mail list' });
    await recent.waitFor();
    const back = page.getByRole('button', { name: 'Back', exact: true });
    const forward = page.getByRole('button', { name: 'Forward', exact: true });
    assert.equal(await back.isDisabled(), true);
    assert.equal(await forward.isDisabled(), true);
    await sidebar.getByRole('button', { name: 'INBOX 3', exact: true }).click();
    await go('Activity');
    await back.click();
    await page.locator('.status-folder').filter({ hasText: /^INBOX:/ }).waitFor();
    await back.click();
    await page.locator('.status-folder').filter({ hasText: /^All folders:/ }).waitFor();
    assert.equal(await back.isDisabled(), true);
    await forward.click();
    await page.locator('.status-folder').filter({ hasText: /^INBOX:/ }).waitFor();
    await sidebar.getByRole('button', { name: 'INBOX 3', exact: true }).click();
    assert.equal(await forward.isEnabled(), true, 'Selecting the current folder preserves forward history');
    await go('Preferences');
    const closeBehavior = page.getByLabel('When I close Bmail', { exact: true });
    assert.equal(await closeBehavior.inputValue(), 'tray');
    await closeBehavior.selectOption('quit');
    await page.waitForFunction(() => sessionStorage.getItem('fixture-close-to-tray') === 'false' && !document.querySelector('#close-behavior').disabled);
    assert.equal(await closeBehavior.inputValue(), 'quit');
    await page.evaluate(() => { window.failPreferences = true; });
    await closeBehavior.selectOption('tray');
    await page.getByRole('alert').filter({ hasText: 'Could not save desktop preferences' }).waitFor();
    assert.equal(await closeBehavior.inputValue(), 'quit', 'Failed saves preserve the last saved behavior');
    await page.evaluate(() => { window.failPreferences = false; });
    await closeBehavior.selectOption('tray');
    await page.waitForFunction(() => sessionStorage.getItem('fixture-close-to-tray') === 'true' && !document.querySelector('#close-behavior').disabled);
    assert.equal(await forward.isDisabled(), true, 'A new destination clears forward history');
    await back.click();
    await page.locator('.status-folder').filter({ hasText: /^INBOX:/ }).waitFor();
    await back.click();
    await page.locator('.status-folder').filter({ hasText: /^All folders:/ }).waitFor();

    assert.match(await recent.textContent(), /<img/);
    await recent.locator('.mail-subject').first().click();
    const reader = page.getByRole('region', { name: 'Email preview' });
    await reader.getByRole('heading', { name: 'Preview subject', exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.lastReadFile), 'emails/INBOX/one.eml');
    const frame = reader.locator('iframe');
    assert.equal(await frame.getAttribute('sandbox'), '');
    const content = await frame.getAttribute('srcdoc');
    assert.doesNotMatch(content, /<script|https:\/\/tracking|javascript:/);
    await page.frameLocator('iframe[title="Email content"]').getByText('Hello from the selected email', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.previewInjected), undefined);
    assert.match(content, /data:image\/png/);
    await go('Preferences');
    await page.getByLabel('Email images', { exact: true }).selectOption('hidden');
    await go('Home');
    assert.match(await frame.getAttribute('srcdoc'), /Image hidden: Embedded logo/);
    assert.doesNotMatch(await frame.getAttribute('srcdoc'), /<img/);
    await go('Preferences');
    await page.getByLabel('Email images', { exact: true }).selectOption('remote');
    await go('Home');
    assert.match(await frame.getAttribute('srcdoc'), /https:\/\/tracking.invalid/);
    assert.match(await frame.getAttribute('srcdoc'), /img-src data: https:/);
    await go('Preferences');
    await page.getByLabel('Email images', { exact: true }).selectOption('embedded');
    await go('Home');

    assert.equal(await page.locator('.workspace-heading, .run-banner, .folder-pane').count(), 0, 'Mailbox starts directly with the email list');
    assert.match(await page.locator('.status-folder').textContent(), /saved.*on server.*remaining/);
    const listBox = await recent.boundingBox(); const readerBox = await reader.boundingBox();
    assert.ok(readerBox.y >= listBox.y + listBox.height - 1, 'The reader is below the message list');
    if (process.env.BMAIL_READER_SCREENSHOT) await page.screenshot({ path: process.env.BMAIL_READER_SCREENSHOT });
    await page.evaluate(() => { window.failReader = true; });
    await recent.locator('.mail-subject').first().click();
    await reader.getByRole('alert').filter({ hasText: 'Saved email is unavailable' }).waitFor();
    await page.evaluate(() => { window.failReader = false; });
    await reader.getByRole('button', { name: 'Retry', exact: true }).click();
    await reader.getByRole('heading', { name: 'Preview subject', exact: true }).waitFor();
    await sidebar.locator('[data-action="select-folder"][data-folder="Sent"]').click();
    await reader.getByRole('heading', { name: 'Select an email to read', exact: true }).waitFor();
    await sidebar.locator('[data-action="select-folder"][data-folder=""]').click();
    await recent.locator('.mail-subject').first().waitFor();


    assert.equal(await page.evaluate(() => window.injected), undefined);
    assert.equal(await page.locator('.statusbar progress').count(), 0);
    await page.evaluate(() => { window.holdExport = true; });
    await recent.locator('[data-action="download-email"]').click();
    await page.locator('.statusbar').getByRole('progressbar', { name: 'Saving downloads', exact: true }).waitFor();
    assert.equal(await page.locator('.statusbar progress').getAttribute('value'), null);
    await page.evaluate(() => { window.holdExport = false; window.finishExport(); });
    await page.locator('.statusbar progress').waitFor({ state: 'detached' });
    await page.waitForFunction(() => window.exports.length === 1);
    assert.deepEqual(await page.evaluate(() => window.exports[0]), { folder: null, file: 'emails/INBOX/one.eml' });
    await sidebar.getByRole('button', { name: 'Download INBOX (.zip)', exact: true }).click();
    await page.waitForFunction(() => window.exports.length === 2);
    assert.deepEqual(await page.evaluate(() => window.exports[1]), { folder: 'INBOX', file: null });
    await page.evaluate(() => { window.failExport = true; });
    await sidebar.getByRole('button', { name: 'Download INBOX (.zip)', exact: true }).click();
    await page.locator('#toast .toast-message').getByText('Export failed', { exact: true }).waitFor();
    const failedToast = page.locator('#toast .toast').filter({ hasText: 'Export failed' });
    assert.equal(await failedToast.getAttribute('role'), 'alert');
    assert.equal(await failedToast.locator('.toast-kind').count(), 1);
    await failedToast.getByRole('button', { name: 'Dismiss notification', exact: true }).click();
    await page.locator('.statusbar [data-action="notifications-open"]').click();
    const notificationPanel = page.getByRole('dialog', { name: 'Notifications', exact: true });
    await notificationPanel.getByText('Export failed', { exact: true }).waitFor();
    if (process.env.BMAIL_NOTIFICATIONS_SCREENSHOT) await page.screenshot({ path: process.env.BMAIL_NOTIFICATIONS_SCREENSHOT });
    assert.ok(await notificationPanel.locator('.notification-item.unread').count() > 0);
    await notificationPanel.getByRole('button', { name: 'Mark all read', exact: true }).click();
    assert.equal(await notificationPanel.locator('.notification-item.unread').count(), 0);
    assert.equal(await page.locator('.statusbar .notification-count').count(), 0);
    await page.keyboard.press('Escape');
    assert.equal(await notificationPanel.isVisible(), false);
    assert.equal(await page.locator('[data-action="notifications-open"]').evaluate(button => button === document.activeElement), true);
    await dismissToasts();

    await page.evaluate(() => { window.failExport = false; });
    await sidebar.getByRole('button', { name: 'INBOX 3', exact: true }).click();
    await page.locator('.status-folder').filter({ hasText: /^INBOX:/ }).waitFor();
    const filter = page.getByRole('searchbox', { name: 'Filter folders' });
    await filter.fill('does-not-exist');
    assert.equal(await sidebar.locator('.folder-row').count(), 0);
    await filter.fill('in'); await filter.press('Home');
    await page.evaluate(() => { window.data.localStats.bytes = 2097152; window.data.mailboxes = { folders: ['INBOX','Sent','Archive','Incoming'] }; document.dispatchEvent(new Event('visibilitychange')); });
    await sidebar.getByRole('button', { name: 'Incoming 0', exact: true }).waitFor();
    await page.keyboard.type('x');
    assert.equal(await filter.inputValue(), 'xin'); await filter.fill('');
    if (process.env.BMAIL_UI_SCREENSHOT) await page.screenshot({ path: process.env.BMAIL_UI_SCREENSHOT });
    await go('Preferences');
    const appearance = page.getByLabel('Theme', { exact: true });
    await appearance.selectOption('dark');
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
    assert.equal(await page.evaluate(() => localStorage.getItem('bmail-theme')), 'dark');
    await page.emulateMedia({ colorScheme: 'light' });
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
    await appearance.selectOption('auto');
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
    if (process.env.BMAIL_DARK_SCREENSHOT) await page.screenshot({ path: process.env.BMAIL_DARK_SCREENSHOT });
    await page.reload();
    await page.getByRole('tab', { name: 'Preferences', exact: true }).click();
    assert.equal(await page.getByLabel('Theme', { exact: true }).inputValue(), 'auto');
    await page.getByLabel('Font', { exact: true }).selectOption('georgia');
    await page.getByLabel('Font size', { exact: true }).selectOption('18');
    assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize), '18px');
    assert.match(await page.evaluate(() => getComputedStyle(document.querySelector('.app-name')).fontFamily), /Georgia/);
    await page.reload();
    await go('Preferences');
    await page.locator('.statusbar [data-action="notifications-open"]').click();
    await page.getByRole('dialog', { name: 'Notifications', exact: true }).getByText('Export failed', { exact: true }).waitFor();
    await page.getByRole('dialog', { name: 'Notifications', exact: true }).getByRole('button', { name: 'Clear all', exact: true }).click();
    await page.getByRole('dialog', { name: 'Notifications', exact: true }).getByRole('heading', { name: 'No notifications yet', exact: true }).waitFor();
    await page.keyboard.press('Escape');
    assert.equal(await page.getByLabel('Font', { exact: true }).inputValue(), 'georgia');
    assert.equal(await page.getByLabel('Font size', { exact: true }).inputValue(), '18');
    await page.getByLabel('Font', { exact: true }).selectOption('system');
    await page.getByLabel('Font size', { exact: true }).selectOption('13');
    if (process.env.BMAIL_PREFERENCES_SCREENSHOT) {
      await page.locator('#toast .toast').last().evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)));
      await page.screenshot({ path: process.env.BMAIL_PREFERENCES_SCREENSHOT });
    }

    await page.getByLabel('Theme', { exact: true }).selectOption('light');
    await page.emulateMedia({ colorScheme: 'dark' });
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'light');
    await go('Home');
    const stableNode = await page.locator('.workspace-navigation').elementHandle();
    await page.getByRole('searchbox', { name: 'Filter folders' }).fill('in');
    assert.equal(await stableNode.evaluate(node => node.isConnected), true, 'Filtering does not rebuild the workspace');
    await page.getByRole('searchbox', { name: 'Filter folders' }).fill('');
    await page.evaluate(() => { window.data.localStats.bytes = 2097152; });
    await refreshLocal();
    await go('Activity');
    assert.equal(await page.getByRole('tab', { name: 'Overview', exact: true }).count(), 0);
    assert.match(await page.locator('.status-folder').textContent(), /Not checked/);
    assert.equal(await page.getByText('About these counts', { exact: true }).count(), 0);
    await page.getByRole('button', { name: 'Sync', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.status-folder')?.textContent.includes('3 on server'));
    assert.match(await page.locator('.status-folder').textContent(), /3 saved.*3 on server.*0 remaining/);

    await page.evaluate(() => { window.data.mailboxStatus.complete = false; window.data.mailboxStatus.missingMessages = 2; window.data.mailboxStatus.totalServerMessages = 5; });
    await refreshLocal();
    await page.waitForFunction(() => document.querySelector('.status-folder')?.textContent.includes('2 remaining'));
    assert.equal(await page.evaluate(() => window.dashboardForces.at(-1)), false, 'Automatic local refresh does not require a separate toolbar action');
    await page.evaluate(() => { window.failCheck = true; });
    await page.getByRole('button', { name: 'Sync', exact: true }).click();
    await page.getByRole('alert').getByText('Connection failed', { exact: true }).waitFor();
    await go('Home');
    assert.equal(await page.locator('.operation-error').isVisible(), true);
    await page.evaluate(() => { window.failCheck = false; });
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await page.locator('.operation-error').waitFor({ state: 'hidden' });
    // Tabs use manual keyboard activation and do not fetch data on arrow focus.
    await tab('Home').focus(); await tab('Home').press('ArrowRight');
    assert.equal(await tab('Backup').evaluate(element => element === document.activeElement), true);
    assert.equal(await tab('Home').getAttribute('aria-selected'), 'true');
    await page.keyboard.press('Enter'); await page.getByRole('tabpanel', { name: 'Backup', exact: true }).waitFor();
    await go('Backup');
    const openBackup = page.getByRole('tabpanel', { name: 'Backup', exact: true }).getByRole('button', { name: 'Open backup folder', exact: true });
    await openBackup.click();
    assert.equal(await page.evaluate(() => window.openedDirectory), 'backups');

    const preferences = page.locator('#selection-panel');
    const controls = page.getByRole('group', { name: 'Backup controls', exact: true });
    assert.equal(await page.locator('.app-toolbar [data-action="backup"]').count(), 0);
    assert.equal(await controls.getByRole('button', { name: 'Pause backup', exact: true }).isDisabled(), true);
    assert.equal(await controls.getByRole('button', { name: 'Stop backup', exact: true }).isDisabled(), true);
    await controls.getByRole('button', { name: 'Start backup', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.backup-controls [data-action="pause"]')?.disabled === false);
    await page.evaluate(() => { window.data.progress.downloaded = 2; document.dispatchEvent(new Event('visibilitychange')); });
    await page.waitForFunction(() => document.querySelector('.backup-page .run-stats dd')?.textContent === '2 / 4');
    await page.evaluate(() => { window.holdControl = true; });
    await controls.getByRole('button', { name: 'Pause backup', exact: true }).click();
    assert.equal(await controls.getByRole('button', { name: 'Stop backup', exact: true }).isDisabled(), true, 'A pending control prevents duplicate commands');
    await page.evaluate(() => { window.holdControl = false; window.finishControl(); });
    await controls.getByRole('button', { name: 'Resume backup', exact: true }).waitFor();
    await controls.getByRole('button', { name: 'Resume backup', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.backup-controls [data-action="pause"]')?.disabled === false);
    await go('Home');
    assert.equal(await page.getByRole('group', { name: 'Backup controls', exact: true }).count(), 0);
    assert.equal(await page.locator('.run-progress').count(), 0, 'Home keeps only compact status-bar progress');
    await go('Backup');
    await controls.getByRole('button', { name: 'Stop backup', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.backup-controls [data-action="backup"]')?.disabled === false);
    assert.deepEqual(await page.evaluate(() => window.controlCommands.map(item => [item.command, item.runId])), [['pause', 'fixture-backup-controls'], ['resume', 'fixture-backup-controls'], ['stop', 'fixture-backup-controls']]);
    await controls.getByRole('button', { name: 'Start backup', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.backup-controls [data-action="cancel"]')?.disabled === false);
    await controls.getByRole('button', { name: 'Cancel backup', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.backup-controls [data-action="backup"]')?.disabled === false);

    await preferences.getByText('Advanced backup options', { exact: true }).click();
    await preferences.getByLabel('Sender contains', { exact: true }).fill('draft@example.com');
    await go('Activity');
    await back.click();
    assert.equal(await preferences.getByLabel('Sender contains', { exact: true }).inputValue(), 'draft@example.com', 'Back restores the form draft');
    await forward.click();
    await page.getByRole('tabpanel', { name: 'Activity', exact: true }).waitFor();
    await back.click();

    await go('Scheduler');
    const scheduler = page.locator('#scheduler-panel');
    await scheduler.getByText('Windows: Not installed', { exact: true }).waitFor();
    assert.equal(await scheduler.locator('.schedule-calendar [data-date]').count(), 42);
    await scheduler.getByLabel('Start date', { exact: true }).fill('2035-01-01');
    await scheduler.getByLabel('Repeat', { exact: true }).selectOption('monthly');
    await scheduler.getByLabel('Day of month', { exact: true }).selectOption('last');
    await scheduler.getByRole('button', { name: 'Load / refresh scheduled folders', exact: true }).click();
    await scheduler.getByLabel('All mailbox folders', { exact: true }).uncheck();
    const folders = scheduler.getByRole('group', { name: 'Scheduled folders', exact: true });
    await folders.getByLabel('Sent', { exact: true }).check();
    await scheduler.getByText('Power, network and recovery', { exact: true }).click();
    await scheduler.getByLabel('Ask Windows to wake the computer', { exact: true }).check();
    const clock = await scheduler.locator('#scheduler-clock').textContent();
    const callsBeforeClockTick = await page.evaluate(() => window.calls.length);
    await page.waitForFunction(previous => document.querySelector('#scheduler-clock')?.textContent !== previous, clock);
    assert.equal(await page.evaluate(() => window.calls.length), callsBeforeClockTick);
    await go('Activity'); await go('Scheduler');
    assert.equal(await scheduler.getByLabel('Start date', { exact: true }).inputValue(), '2035-01-01');
    assert.equal(await folders.getByLabel('Sent', { exact: true }).isChecked(), true, 'Scheduler drafts survive tab changes');
    const calendarButton = scheduler.locator('.schedule-calendar [tabindex="0"]');
    await calendarButton.focus(); await calendarButton.press('ArrowRight'); await page.keyboard.press('Enter');
    assert.equal(await scheduler.getByLabel('Start date', { exact: true }).inputValue(), '2035-01-02');
    if (process.env.BMAIL_SCHEDULER_SCREENSHOT) await page.screenshot({ path: process.env.BMAIL_SCHEDULER_SCREENSHOT });
    await scheduler.getByRole('button', { name: 'Save schedule', exact: true }).click();
    await scheduler.getByText('Windows: Ready', { exact: true }).waitFor();
    assert.deepEqual(await page.evaluate(() => window.scheduleState.settings.folders), ['Sent']);
    assert.equal(await page.evaluate(() => window.scheduleState.settings.allFolders), false);
    assert.deepEqual(await page.evaluate(() => window.data.backupOptions.folders), ['INBOX'], 'Scheduled selection must not overwrite manual folders');
    await scheduler.getByLabel('Enable scheduled backups', { exact: true }).uncheck();
    await scheduler.getByRole('button', { name: 'Save schedule', exact: true }).click();
    await scheduler.getByText('Windows: Disabled', { exact: true }).waitFor();
    await page.evaluate(() => { window.failSchedule = true; });
    await dismissToasts();
    await scheduler.getByRole('button', { name: 'Refresh status', exact: true }).click();
    await scheduler.getByText('Windows scheduler unavailable', { exact: true }).waitFor();
    await page.evaluate(() => { window.failSchedule = false; });
    await scheduler.getByRole('button', { name: 'Remove schedule', exact: true }).click();
    await scheduler.getByText('Windows: Not installed', { exact: true }).waitFor();
    await go('Backup');
    assert.equal(await preferences.getByLabel('Sender contains', { exact: true }).inputValue(), 'draft@example.com', 'Manual option drafts survive other views');
    await preferences.getByRole('button', { name: 'Last 30 days', exact: true }).click();
    await preferences.getByLabel('Sender contains', { exact: true }).fill('billing@example.com');
    await preferences.getByLabel('Connection attempts', { exact: true }).fill('5');
    await preferences.getByLabel('Unread messages only', { exact: true }).check();
    await preferences.getByLabel('Notify when a backup completes', { exact: true }).check();
    await preferences.getByRole('button', { name: 'Send test notification', exact: true }).click();
    await preferences.locator('#notification-status').getByText('Test notification requested', { exact: true }).waitFor();
    await preferences.getByRole('button', { name: 'Save selection', exact: true }).click();
    await page.locator('#toast').getByText('Backup options saved', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.savedOptions.advanced.lastDays), 30);
    assert.equal(await page.evaluate(() => window.savedOptions.advanced.sender), 'billing@example.com');
    assert.equal(await page.evaluate(() => window.savedOptions.advanced.notifyOnSuccess), true);
    await page.evaluate(() => { window.data.history = [
      { runId: 'history-complete', outcome: 'completed', downloaded: 3, startedAt: '2032-01-01T10:00:00Z', finishedAt: '2032-01-01T10:02:00Z', durationSeconds: 120 },
      { runId: 'history-failed', outcome: 'failed', downloaded: 0, startedAt: '2031-12-31T10:00:00Z', finishedAt: '2031-12-31T10:01:00Z', durationSeconds: 60, error: { message: '<script>historyInjection</script>', code: 'FIXTURE_ERROR' } },
    ]; });
    await refreshLocal(); await go('Activity');
    const history = page.getByRole('region', { name: 'Backup history' });
    assert.equal(await history.locator('tbody tr').count(), 2);
    const runDetails = page.getByRole('region', { name: 'Run details', exact: true });
    await runDetails.getByRole('heading', { name: 'Select a backup run' }).waitFor();
    assert.equal(await page.getByRole('region', { name: 'Activity log' }).count(), 0);
    await history.locator('tbody tr').nth(1).locator('td').nth(1).click();
    await runDetails.getByText(/historyInjection/).waitFor();
    assert.equal(await history.locator('tbody tr.selected').count(), 1);
    assert.equal(await history.locator('script').count(), 0);
    const tableBox = await history.locator('.history-list').boundingBox();
    const detailsBox = await runDetails.boundingBox();
    assert.ok(detailsBox.y >= tableBox.y + tableBox.height, 'Run details appear below the full-width history table');
    await history.locator('#history-filter').selectOption('completed');
    assert.equal(await history.locator('tbody tr').count(), 1);
    await runDetails.getByRole('heading', { name: 'Select a backup run' }).waitFor();
    await history.locator('tbody button').first().focus(); await page.keyboard.press('Enter');
    await runDetails.getByRole('heading', { name: 'Run details', exact: true }).waitFor();
    assert.equal(await runDetails.getByText(/historyInjection/).count(), 0);
    await go('Home'); await go('Activity');
    await runDetails.getByRole('heading', { name: 'Run details', exact: true }).waitFor();
    assert.equal(await history.locator('#history-filter').inputValue(), 'completed');
    await history.locator('#history-filter').selectOption('all');
    await history.locator('tbody tr').nth(1).locator('td').nth(1).click();
    await refreshLocal();
    await runDetails.getByText(/historyInjection/).waitFor();
    const width = await history.locator('table').evaluate(table => table.getBoundingClientRect().width);
    assert.ok(width >= await history.evaluate(el => el.clientWidth) - 2, 'History table spans the workspace');
    assert.equal(await page.locator('.workspace-heading').count(), 0);
    await page.evaluate(() => { window.data.history[1].downloaded = 7; });
    await refreshLocal();
    await page.waitForFunction(() => [...document.querySelectorAll('.history-details dl > div')].some(item => item.querySelector('dt')?.textContent === 'Downloaded' && item.querySelector('dd')?.textContent === '7'));

    if (process.env.BMAIL_ACTIVITY_SCREENSHOT) await page.screenshot({ path: process.env.BMAIL_ACTIVITY_SCREENSHOT });
    await go('Preferences'); await page.getByLabel('Theme', { exact: true }).selectOption('dark');
    await go('Activity');
    if (process.env.BMAIL_ACTIVITY_DARK_SCREENSHOT) await page.screenshot({ path: process.env.BMAIL_ACTIVITY_DARK_SCREENSHOT });
    await page.setViewportSize({ width: 760, height: 620 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Activity fits the smaller desktop window');
    await page.setViewportSize({ width: 1120, height: 780 });
    await go('Preferences'); await page.getByLabel('Theme', { exact: true }).selectOption('light');
    await go('Activity');

    assert.equal(await page.locator('.history-pane').count(), 1, 'Activity contains the backup history table');
    await page.evaluate(() => { window.data.backupRunning = true; window.data.progress = { state: 'running', phase: 'downloading', downloaded: 2, plannedDownloads: 8, processedMessages: 2, totalMessages: 8 }; });
    await refreshLocal(); await go('Activity');
    await page.locator('.status-message').getByText('Backup active', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Sync', exact: true }).isDisabled(), true);
    const statusProgress = page.locator('.statusbar').getByRole('progressbar', { name: 'Download progress', exact: true });
    assert.equal(await statusProgress.getAttribute('value'), '25');
    assert.match(await page.locator('.statusbar').textContent(), /2 \/ 8 \(25%\)/);
    await go('Backup');
    await preferences.getByLabel('Sender contains', { exact: true }).fill('live-draft@example.com');
    await page.evaluate(() => { window.data.progress.downloaded = 4; document.dispatchEvent(new Event('visibilitychange')); });
    await page.waitForFunction(() => document.querySelector('.statusbar progress')?.value === 50);
    assert.equal(await preferences.getByLabel('Sender contains', { exact: true }).inputValue(), 'live-draft@example.com');
    await page.evaluate(() => { window.data.progress.state = 'paused'; document.dispatchEvent(new Event('visibilitychange')); });
    await page.locator('.statusbar').getByText('Download paused: 4 / 8 (50%)', { exact: true }).waitFor();
    await page.evaluate(() => { window.data.progress = { state: 'running', phase: 'discovering' }; document.dispatchEvent(new Event('visibilitychange')); });
    await page.waitForFunction(() => document.querySelector('.statusbar progress') && !document.querySelector('.statusbar progress').hasAttribute('value'));
    await page.locator('.statusbar').getByText('Counting emails...', { exact: true }).waitFor();
    await page.evaluate(() => { window.data.progress = { state: 'completed', downloaded: 8, plannedDownloads: 8 }; document.dispatchEvent(new Event('visibilitychange')); });
    await page.locator('.statusbar').getByText('Finishing backup...', { exact: true }).waitFor();
    assert.equal(await statusProgress.getAttribute('value'), null, 'A previous completed snapshot does not imply progress for an active run');
    await go('Activity');

    for (const size of [{ width: 1120, height: 780 }, { width: 760, height: 620 }]) {
      await page.setViewportSize(size);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'No horizontal window overflow');
      assert.equal(await page.locator('[role="tabpanel"]:not([hidden])').count(), 1);
    }
    await go('Preferences');
    await page.getByLabel('Theme', { exact: true }).selectOption('dark');
    for (const tab of ['Home', 'Backup', 'Scheduler', 'Activity', 'Preferences']) {
      await go(tab);
      assert.notEqual(await page.locator('.mail-workspace').evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(255, 255, 255)');
      assert.equal(await page.locator('.workspace-heading').count(), 0, 'No tab has a title and account header');
    }
    await page.evaluate(() => {
      window.data.backupRunning = false;
      window.data.localStats.messages = 36;
      window.data.localStats.recent = Array.from({ length: 35 }, (_, index) => ({ subject: `Message ${index + 1}`, sender: `Sender ${35 - index}`, folder: 'INBOX', file: `mail-${index}.eml`, sentAt: new Date(Date.UTC(2026, 10, index + 1)).toISOString(), bytes: (index + 1) * 1024, backedUp: index % 2 === 0 }));
      window.data.localStats.recent.push({ subject: 'Sent mail', sender: 'Me', folder: 'Sent', file: 'sent.eml', sentAt: '2026-11-01T00:00:00Z', bytes: 512, backedUp: true });
    });
    await refreshLocal();
    await go('Home');
    await sidebar.locator('[data-action="select-folder"][data-folder="INBOX"]').click();
    await page.waitForFunction(() => document.querySelectorAll('.mail-table tbody tr').length === 35);
    const mail = page.getByRole('region', { name: 'Mail list' });
    const sortColumn = column => mail.locator(`[data-action="sort-mail"][data-column="${column}"]`);
    const firstCell = column => column === 1 ? mail.locator("tbody tr:first-child .mail-subject") : mail.locator(`tbody tr:first-child td:nth-child(${column})`);
    await sortColumn('subject').click();
    assert.equal(await firstCell(1).textContent(), 'Message 1');
    assert.equal(await mail.locator('th[aria-sort]').getAttribute('aria-sort'), 'ascending');
    await page.keyboard.press('Enter');
    assert.equal(await firstCell(1).textContent(), 'Message 35');
    assert.equal(await mail.locator('th[aria-sort]').getAttribute('aria-sort'), 'descending');
    await sortColumn('sender').click();
    assert.equal(await firstCell(2).textContent(), 'Sender 1');
    await sortColumn('sender').click();
    assert.equal(await firstCell(2).textContent(), 'Sender 35');
    await sortColumn('sentAt').click();
    assert.equal(await firstCell(1).textContent(), 'Message 1');
    await sortColumn('sentAt').click();
    assert.equal(await firstCell(1).textContent(), 'Message 35');
    await sortColumn('bytes').click();
    assert.equal(await firstCell(5).textContent(), '1.0 KB');
    await sortColumn('bytes').click();
    assert.equal(await firstCell(5).textContent(), '35.0 KB');
    assert.equal(await mail.locator('tbody tr.backed-up').count(), 18);
    assert.equal(await mail.locator('tbody tr:not(.backed-up)').count(), 17);
    const backedBackground = await mail.locator('tbody tr.backed-up').first().evaluate(row => getComputedStyle(row).backgroundColor);
    const otherBackground = await mail.locator('tbody tr:not(.backed-up)').first().evaluate(row => getComputedStyle(row).backgroundColor);
    assert.notEqual(backedBackground, otherBackground, 'Backed up emails have a distinct faded background');


    await sidebar.locator('[data-action="select-folder"][data-folder=""]').click();
    await page.waitForFunction(() => document.querySelectorAll('.mail-table tbody tr').length === 36);
    await sortColumn('folder').click();
    assert.equal(await firstCell(3).textContent(), 'INBOX');
    await sortColumn('folder').click();
    assert.equal(await firstCell(3).textContent(), 'Sent');
    await go('Activity'); await go('Home');
    assert.equal(await mail.locator('th[aria-sort] button').getAttribute('data-column'), 'folder');
    assert.equal(await mail.locator('th[aria-sort]').getAttribute('aria-sort'), 'descending');
    assert.equal(await mail.getByRole('heading', { name: 'Saved mail' }).count(), 0);
    assert.equal(await page.getByRole('heading', { name: 'Folder coverage' }).count(), 0);
    const subjectHandle = mail.getByRole('separator', { name: 'Resize Subject column', exact: true });
    await subjectHandle.scrollIntoViewIfNeeded();
    const subjectWidth = () => mail.locator('thead th').first().evaluate(el => el.getBoundingClientRect().width);
    const widthBefore = await subjectWidth();
    const handleBox = await subjectHandle.boundingBox();
    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
    await page.mouse.down(); await page.mouse.move(handleBox.x + handleBox.width / 2 + 70, handleBox.y + handleBox.height / 2, { steps: 8 }); await page.mouse.up();
    const widthAfter = await subjectWidth();
    assert.ok(Math.abs(widthAfter - widthBefore - 70) < 3, 'Dragging changes the subject width');
    assert.equal(await mail.locator('th[aria-sort] button').getAttribute('data-column'), 'folder', 'Resizing does not change sorting');
    await subjectHandle.focus(); await page.keyboard.press('ArrowRight');
    const keyboardWidth = await subjectWidth();
    assert.ok(Math.abs(keyboardWidth - widthAfter - 10) < 2, 'Arrow keys adjust the width');
    await sortColumn('subject').click();
    assert.ok(Math.abs(await subjectWidth() - keyboardWidth) < 2, 'Sorting retains column widths');
    await go('Activity'); await go('Home');
    assert.ok(Math.abs(await subjectWidth() - keyboardWidth) < 2, 'Tab changes retain column widths');
    await page.reload();
    await page.waitForFunction(() => document.querySelector('.mail-table tbody tr'));
    assert.ok(Math.abs(await subjectWidth() - keyboardWidth) < 2, 'Mail widths persist across reloads');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Wide tables scroll inside the workspace');
    await page.evaluate(() => { window.data.localStats.recent[0].subject = 'Short subject'; });
    await refreshLocal();
    await mail.locator('tbody tr').first().waitFor();
    await subjectHandle.scrollIntoViewIfNeeded();
    await subjectHandle.dblclick();
    const fittedWidth = await subjectWidth();
    assert.ok(fittedWidth < keyboardWidth - 20, `Double-click shrinks a short-content column to fit (${keyboardWidth} to ${fittedWidth})`);
    const hasRightGap = table => table.evaluate(el => el.getBoundingClientRect().width + 1 < el.parentElement.clientWidth);
    assert.equal(await hasRightGap(mail.locator('table')), false, 'Auto-fit never leaves a gap at the right border');
    await page.setViewportSize({ width: 1400, height: 780 });
    assert.equal(await hasRightGap(mail.locator('table')), false, 'The table still fills a wider window');
    await page.evaluate(() => { window.data.localStats.recent[0].subject = 'A much longer subject that should expand when the divider is double-clicked'; });
    await refreshLocal();
    await mail.locator('tbody tr').first().waitFor();
    await subjectHandle.scrollIntoViewIfNeeded();
    await subjectHandle.dblclick();
    const expandedWidth = await subjectWidth();
    assert.ok(expandedWidth > fittedWidth + 100, 'Auto-fit measures long content beyond the current clipped width');
    assert.equal(await mail.locator('th[aria-sort] button').getAttribute('data-column'), 'sentAt', 'Auto-fit does not sort the table');
    await refreshLocal();
    await mail.locator('tbody tr').first().waitFor();
    assert.ok(Math.abs(await subjectWidth() - expandedWidth) < 2, 'Auto-fit persists across table refreshes');
    for (const width of [760, 1120, 1400]) {
      await page.setViewportSize({ width, height: 780 });
      for (const selector of ['.mail-table']) {
        const table = page.locator(selector);
        await page.waitForFunction(selector => { const table = document.querySelector(selector); return table && table.parentElement.scrollWidth <= table.parentElement.clientWidth + 1; }, selector);
        const handle = table.getByRole('separator').first();
        await handle.scrollIntoViewIfNeeded();
        const box = await handle.boundingBox();
        await page.mouse.move(box.x + 4, box.y + box.height / 2);
        await page.mouse.down(); await page.mouse.move(width + 500, box.y + box.height / 2, { steps: 8 }); await page.mouse.up();
        assert.equal(await table.evaluate(table => table.parentElement.scrollWidth <= table.parentElement.clientWidth + 1), true, 'Dragging cannot create horizontal overflow');
        const sizes = await table.locator('thead th').evaluateAll(cells => cells.map(cell => cell.getBoundingClientRect().width));
        sizes.forEach((size, index) => assert.ok(size >= (index >= 3 ? 112 : 72) - 2, 'Every column remains visible'));
        await handle.focus(); await page.keyboard.press('Shift+ArrowRight');
        await handle.dblclick();
        assert.equal(await table.evaluate(table => table.parentElement.scrollWidth <= table.parentElement.clientWidth + 1), true, 'Keyboard resize and auto-fit stay inside the viewport');
      }
    }


    await page.evaluate(() => {
      window.data.backupRunning = false;
      window.data.mailboxes = { folders: Array.from({ length: 1000 }, (_, i) => `Folder-${i}`) };
    });
    await refreshLocal();
    await go('Home');
    const beforeFilter = await page.locator('.workspace-navigation').elementHandle();
    const started = performance.now();
    await page.getByRole('searchbox', { name: 'Filter folders' }).fill('Folder-999');
    await page.getByRole('navigation', { name: 'Mailbox folders' }).getByRole('button', { name: 'Folder-999 0', exact: true }).waitFor();
    assert.equal(await beforeFilter.evaluate(node => node.isConnected), true);
    console.log(`1,000-folder filter completed in ${Math.round(performance.now() - started)} ms without rebuilding the workspace.`);
    assert.equal(await page.evaluate(() => window.newMailChecks), 1, 'Polling and navigation do not repeat the startup check');

    const sidebarDivider = page.getByRole('separator', { name: 'Resize folder sidebar', exact: true });
    const mailDivider = page.getByRole('separator', { name: 'Resize mail list and reading pane', exact: true });
    const sidebarWidth = () => page.locator('.folder-sidebar').evaluate(el => el.getBoundingClientRect().width);
    const listHeight = () => page.locator('.mail-pane').evaluate(el => el.getBoundingClientRect().height);
    const sidebarBefore = await sidebarWidth();
    const sidebarBox = await sidebarDivider.boundingBox();
    await page.mouse.move(sidebarBox.x + 3, sidebarBox.y + 100); await page.mouse.down();
    await page.mouse.move(sidebarBox.x + 63, sidebarBox.y + 100, { steps: 8 }); await page.mouse.up();
    assert.ok(Math.abs(await sidebarWidth() - sidebarBefore - 60) < 2, 'Sidebar divider adjusts the nav width');
    await sidebarDivider.focus(); await page.keyboard.press('ArrowRight');
    const storedSidebar = await sidebarWidth();
    await page.locator('.mail-subject').first().click();
    await page.getByRole('region', { name: 'Email preview' }).getByRole('heading', { name: 'Preview subject' }).waitFor();
    const listBefore = await listHeight();
    const mailBox = await mailDivider.boundingBox();
    await page.mouse.move(mailBox.x + mailBox.width / 2, mailBox.y + 3); await page.mouse.down();
    await page.mouse.move(mailBox.x + mailBox.width / 2, mailBox.y + 53, { steps: 8 }); await page.mouse.up();
    assert.ok(Math.abs(await listHeight() - listBefore - 50) < 2, 'Mail divider resizes the list over the embedded reader');
    await mailDivider.focus(); await page.keyboard.press('ArrowDown');
    const storedList = await listHeight();
    await go('Activity'); await go('Home');
    assert.ok(Math.abs(await listHeight() - storedList) < 2);
    await page.reload();
    await page.locator('.mail-table tbody tr').first().waitFor();
    await page.waitForFunction(expected => Math.abs(document.querySelector('.folder-sidebar').getBoundingClientRect().width - expected) < 2, storedSidebar);
    assert.ok(Math.abs(await listHeight() - storedList) < 2, 'Pane sizes persist after reload');
    await page.setViewportSize({ width: 760, height: 620 });
    await sidebarDivider.focus();
    for (let i = 0; i < 25; i++) await page.keyboard.press('Shift+ArrowRight');
    assert.ok(await page.locator('.mail-workspace').evaluate(el => el.getBoundingClientRect().width) >= 439, 'Sidebar reserves room for mail columns');
    await mailDivider.focus();
    for (let i = 0; i < 25; i++) await page.keyboard.press('Shift+ArrowDown');
    assert.ok(await page.locator('.reading-pane').evaluate(el => el.getBoundingClientRect().height) >= 139, 'Reading pane keeps a usable minimum height');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await sidebarDivider.dblclick(); await mailDivider.dblclick();
    await page.evaluate(() => {
      window.data.localStats.recent = Array.from({ length: 123 }, (_, index) => ({ id: `page-${index + 1}`, file: `page-${index + 1}.eml`, folder: 'INBOX', subject: `Page message ${index + 1}`, sender: 'pagination@example.test', sentAt: new Date(Date.UTC(2026, 0, index + 1)).toISOString(), bytes: index, backedUp: true }));
    });
    await refreshLocal();
    await go('Home');
    await page.waitForFunction(() => document.querySelectorAll('.mail-table tbody tr').length === 50);
    const pager = page.getByRole('navigation', { name: 'Mail pagination', exact: true });
    assert.match(await pager.textContent(), /1-50 of 123 messages/);
    assert.equal(await pager.getByRole('button', { name: 'Previous page', exact: true }).isDisabled(), true);
    await pager.getByRole('button', { name: 'Next page', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.mail-page-summary')?.textContent === '51-100 of 123 messages');
    await pager.getByRole('button', { name: 'Last page', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('.mail-table tbody tr').length === 23);
    assert.equal(await pager.getByRole('button', { name: 'Next page', exact: true }).isDisabled(), true);
    await page.getByLabel('Per page', { exact: true }).selectOption('25');
    await page.waitForFunction(() => document.querySelector('.mail-page-summary')?.textContent === '1-25 of 123 messages');
    await page.locator('[data-action="sort-mail"][data-column="subject"]').click();
    await page.waitForFunction(() => document.querySelector('.mail-table tbody tr:first-child .mail-subject')?.textContent === 'Page message 1');
    await pager.getByRole('button', { name: 'Next page', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.mail-table tbody tr:first-child .mail-subject')?.textContent === 'Page message 26');
    await sidebar.locator('[data-action="select-folder"][data-folder="Sent"]').click();
    await page.waitForFunction(() => document.querySelector('.mail-page-summary')?.textContent === '0 messages');
    await sidebar.locator('[data-action="select-folder"][data-folder=""]').click();
    await page.waitForFunction(() => document.querySelector('.mail-page-summary')?.textContent === '1-25 of 123 messages');
    await page.getByLabel('Per page', { exact: true }).selectOption('50');
    await page.waitForFunction(() => document.querySelectorAll('.mail-table tbody tr').length === 50);
    await page.evaluate(() => {
      window.data.localStats.recent = [
        { id: 'server-new', file: '', folder: 'INBOX', subject: 'New server mail', sender: 'sender@example.test', isNew: true, onServer: true, backedUp: false },
        { id: 'server-old', file: '', folder: 'INBOX', subject: 'Existing server mail', sender: 'sender@example.test', isNew: false, onServer: true, backedUp: false },
        { id: 'saved-new', file: 'saved-new.eml', folder: 'INBOX', subject: 'New saved mail', sender: 'sender@example.test', isNew: true, onServer: true, backedUp: true },
      ];
    });
    await refreshLocal();
    await go('Home');
    const serverNew = page.locator('.mail-table tbody tr').filter({ hasText: 'New server mail' });
    await serverNew.waitFor();
    assert.equal(await serverNew.locator('.state-new').textContent(), 'New');
    assert.equal(await serverNew.locator('.state-not-backed-up').textContent(), 'Not backed up');
    assert.equal(await serverNew.locator('.download-icon').isDisabled(), true);
    await serverNew.locator('.mail-subject').click();
    await page.getByRole('region', { name: 'Email preview' }).getByRole('heading', { name: 'Not backed up', exact: true }).waitFor();
    assert.equal(await page.locator('.mail-table tbody tr').filter({ hasText: 'Existing server mail' }).locator('.state-new').count(), 0);
    assert.equal(await page.locator('.mail-table tbody tr').filter({ hasText: 'New saved mail' }).locator('.mail-state').count(), 2);
    if (process.env.BMAIL_MAIL_SCREENSHOT) await page.screenshot({ path: process.env.BMAIL_MAIL_SCREENSHOT });
    await page.evaluate(() => sessionStorage.setItem('fixture-new-mail-failure', 'NEW_MAIL_CHECK_BUSY'));
    await page.reload();
    await page.waitForFunction(() => window.newMailChecks === 1 && document.querySelector('.status-message')?.textContent === '');
    assert.equal(await page.locator('.operation-error').count(), 0, 'Busy startup checks do not show a failure');
    assert.equal(await page.locator('#toast').textContent(), '');
    await page.evaluate(() => { window.newMailFailure = ''; document.dispatchEvent(new Event('visibilitychange')); });
    assert.equal(await page.evaluate(() => window.newMailChecks), 1, 'Busy retries respect their cooldown');
    await page.waitForFunction(() => window.newMailChecks === 2 && document.querySelector('.statusbar .new-mail-badge'));
    await page.evaluate(() => sessionStorage.setItem('fixture-new-mail-failure', 'Connection timed out'));
    await page.reload();
    await page.locator('.operation-error').getByText('Connection timed out', { exact: true }).waitFor();
    await page.evaluate(() => { window.newMailFailure = ''; sessionStorage.removeItem('fixture-new-mail-failure'); });
    await page.locator('.operation-error').getByRole('button', { name: 'Retry', exact: true }).click();
    await page.waitForFunction(() => window.newMailChecks === 2 && !document.querySelector('.operation-error') && document.querySelector('.statusbar .new-mail-badge'));
    assert.deepEqual(errors, []);
    assert.equal(await page.locator('.statusbar progress').count(), 0, 'Finished runs clear the status progress bar');
    console.log('Tabbed workspace passed: no duplicate panels, keyboard tabs, retained drafts, independent scheduled folders, calendar, retries, history, notifications and responsive layout.');
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
