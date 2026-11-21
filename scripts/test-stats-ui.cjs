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
    response.setHeader('Content-Type', target.endsWith('.js') ? 'text/javascript' : target.endsWith('.css') ? 'text/css' : target.endsWith('.svg') ? 'image/svg+xml' : target.endsWith('.png') ? 'image/png' : 'text/html');
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
        cloudDropbox: { configured: true, connected: false, automatic: false, stage: 'disconnected' },
        localStats: { messages: 3, bytes: 1048576, folders: [{ name: 'INBOX', messages: 3 }], recent: [
          { file: 'emails/INBOX/one.eml', subject: '<img src=x onerror="window.injected=true">', sender: 'fixture@example.com', folder: 'INBOX', sentAt: '2020-01-02T00:00:00Z', bytes: 2048, backedUp: true, backedUpAt: '2026-11-15T00:00:00Z' },
        ] }, lastRun: { success: true, downloaded: 1, finishedAt: '2026-11-15T00:00:00Z' } };
      window.__TAURI_INTERNALS__ = { metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } }, invoke: async (name, args) => {
        window.calls.push(name);
        if (name.startsWith('plugin:window|')) return;
        if (name === 'finish_startup') return;
        if (name === 'get_microsoft_sign_in_status') return { available: sessionStorage.getItem('fixture-microsoft-unavailable') !== 'true' };
        if (name === 'begin_outlook_sign_in') {
          window.microsoftSignInArgs = args;
          return { device_code: 'fixture-device', user_code: 'TEST-CODE', verification_uri: 'https://microsoft.com/devicelogin', expires_in: 900, interval: 5 };
        }
        if (name === 'configure_mailbox') { window.mailboxSettings = { ...args.settings }; return 'Mailbox saved'; }

        if (name === 'open_directory') { window.openedDirectory = args.kind; return; }
        if (name === 'get_desktop_preferences') return { closeToTray: sessionStorage.getItem('fixture-close-to-tray') !== 'false' };
        if (name === 'cloud_dropbox') {
          const state = window.data.cloudDropbox;
          if (args.action === 'connect') Object.assign(state, { connected: true, stage: 'ready', dropboxAccount: 'dropbox-fixture@example.test', errorCode: '' });
          if (args.action === 'automatic') state.automatic = args.value;
          if (args.action === 'sync') {
            Object.assign(state, { stage: 'uploading', totalFiles: 2, completedFiles: 0, errorCode: '' });
            if (window.holdDropbox) await new Promise(resolve => { window.finishDropbox = resolve; });
            Object.assign(state, window.failDropbox ? { stage: 'error', errorCode: 'quota' } : { stage: 'ready', completedFiles: 2, lastSyncedAt: new Date().toISOString() });
          }
          if (args.action === 'disconnect') Object.assign(state, { connected: false, automatic: false, stage: 'disconnected', errorCode: '', dropboxAccount: '' });
          return { ...state };
        }
        if (name === 'cloud_drive') {
          const state = window.data.cloudDrive ||= {};
          if (args.action === 'setup') Object.assign(state, { configured: true, connected: false, stage: 'disconnected', errorCode: '' });
          if (args.action === 'connect') Object.assign(state, { connected: true, stage: 'ready', driveAccount: 'drive-fixture@example.test', errorCode: '' });
          if (args.action === 'automatic') state.automatic = args.value;
          if (args.action === 'sync') {
            Object.assign(state, { stage: 'uploading', totalFiles: 2, completedFiles: 0, errorCode: '' });
            if (window.holdDrive) await new Promise(resolve => { window.finishDrive = resolve; });
            Object.assign(state, window.failDrive ? { stage: 'error', errorCode: 'quota' } : { stage: 'ready', completedFiles: 2, lastSyncedAt: new Date().toISOString() });
          }
          if (args.action === 'disconnect') Object.assign(state, { connected: false, automatic: false, stage: 'disconnected', errorCode: '' });
          return { ...state };
        }
        if (name === 'save_desktop_preferences') {
          if (window.failPreferences) throw 'Could not save desktop preferences';
          sessionStorage.setItem('fixture-close-to-tray', String(args.preferences.closeToTray));
          return args.preferences;
        }
        if (name === 'set_mail_badge') { (window.badgeUpdates ||= []).push(args); return; }
        if (name === 'export_mail') { window.exports.push(args); if (window.holdExport) await new Promise(resolve => { window.finishExport = resolve; }); if (window.failExport) throw 'Export failed'; return 'Download saved.'; }
        if (name === 'start_backup') {
          window.backupMessage = args?.message;
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
        if (name === 'get_saved_mail') return window.data.localStats.recent.filter(mail => mail.backedUp && (!args.folder || mail.folder === args.folder));
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
          if (window.holdCheck) await new Promise(resolve => { window.finishCheck = resolve; });
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

    await page.waitForFunction(() => !document.querySelector('.mail-pane[aria-busy="true"]'));
    await page.evaluate(() => { window.homeControl = document.querySelector('#tab-mailbox'); window.activityControl = document.querySelector('#tab-activity'); });
    const homeWidth = await tab('Home').evaluate(el => el.getBoundingClientRect().width);
    for (let i = 0; i < 4; i++) {
      await go('Activity');
      await page.evaluate(() => { window.data.localStats.bytes++; });
      await refreshLocal();
      await go('Home');
      await page.evaluate(() => { window.data.localStats.bytes++; });
      await refreshLocal();
      assert.equal(await page.evaluate(() => window.homeControl === document.querySelector('#tab-mailbox') && window.activityControl === document.querySelector('#tab-activity')), true, 'Home and Activity controls survive navigation and dashboard redraws');
    }
    assert.equal(await tab('Home').evaluate(el => el.getBoundingClientRect().width), homeWidth, 'Selection does not shift tab widths');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await go('Activity');
    assert.equal(await page.getByRole('tabpanel', { name: 'Activity', exact: true }).evaluate(el => el.getAnimations().length), 0, 'Reduced motion disables tab transitions');
    await go('Home');
    await page.emulateMedia({ reducedMotion: 'no-preference' });

    const sidebar = page.getByRole('navigation', { name: 'Mailbox folders' });
    // Start the existing history scenarios with a fresh navigation stack.
    await page.reload();
    await page.waitForFunction(() => document.querySelector('.folder-row[data-folder="INBOX"] .new-mail-badge'));
    assert.equal(await page.evaluate(() => window.newMailChecks), 1);
    assert.equal(await page.locator('.statusbar .new-mail-badge').count(), 0);
    await page.waitForFunction(() => window.badgeUpdates?.at(-1)?.count === 3);
    assert.equal(await page.evaluate(() => window.badgeUpdates.at(-1).account), 'fixture@example.com');
    assert.equal(await page.locator('.app-toolbar [data-action="notifications-open"]').count(), 1);
    assert.equal(await page.locator('.statusbar [data-action="notifications-open"]').count(), 0);
    const summaryBox = await page.locator('.status-summary').boundingBox();
    const footerBox = await page.locator('.statusbar').boundingBox();
    assert.ok(Math.abs(summaryBox.x + summaryBox.width - footerBox.x - footerBox.width + 12) <= 2, 'Folder and schedule summaries align with the right status-bar edge');
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
    await page.getByRole('alert').filter({ hasText: 'Could not load or save your preferences. Restart Bmail and try again.' }).waitFor();
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
    assert.match(await page.locator('.status-folder').textContent(), /saved.*on server.*last mailbox check/);
    const listBox = await recent.boundingBox(); const readerBox = await reader.boundingBox();
    assert.ok(readerBox.y >= listBox.y + listBox.height - 1, 'The reader is below the message list');
    if (process.env.BMAIL_READER_SCREENSHOT) await page.screenshot({ path: process.env.BMAIL_READER_SCREENSHOT });
    await page.evaluate(() => { window.failReader = true; });
    await recent.locator('.mail-subject').first().click();
    await reader.getByRole('alert').filter({ hasText: 'This saved email is unavailable.' }).waitFor();
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
    await page.locator('#toast .toast-message').getByText('Could not save the email. Check the destination folder and available disk space, then try again.', { exact: true }).waitFor();
    const failedToast = page.locator('#toast .toast').filter({ hasText: 'Could not save the email.' });
    assert.equal(await failedToast.getAttribute('role'), 'alert');
    assert.equal(await failedToast.locator('.toast-kind').count(), 1);
    await failedToast.getByRole('button', { name: 'Dismiss notification', exact: true }).click();
    await page.locator('.app-toolbar [data-action="notifications-open"]').click();
    const notificationPanel = page.getByRole('dialog', { name: 'Notifications', exact: true });
    assert.equal(await notificationPanel.getByText('Could not save the email. Check the destination folder and available disk space, then try again.', { exact: true }).count(), 0);
    const bellBounds = await page.locator('.navbar-notifications .notification-bell').boundingBox();
    const panelBounds = await notificationPanel.boundingBox();
    assert.ok(Math.abs(panelBounds.y - bellBounds.y - bellBounds.height - 8) <= 2, 'Notifications open directly below the bell');
    assert.ok(Math.abs(panelBounds.x + panelBounds.width - bellBounds.x - bellBounds.width) <= 2, 'The panel aligns with the bell right edge');

    if (process.env.BMAIL_NOTIFICATIONS_SCREENSHOT) await page.screenshot({ path: process.env.BMAIL_NOTIFICATIONS_SCREENSHOT });
    assert.ok(await notificationPanel.locator('.notification-item.unread').count() > 0);
    await notificationPanel.getByRole('button', { name: 'Mark all read', exact: true }).click();
    assert.equal(await notificationPanel.locator('.notification-item.unread').count(), 0);
    assert.equal(await page.locator('.app-toolbar .notification-count').count(), 0);
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
    await page.locator('.app-toolbar [data-action="notifications-open"]').click();
    assert.equal(await page.getByRole('dialog', { name: 'Notifications', exact: true }).getByText('Could not save the email. Check the destination folder and available disk space, then try again.', { exact: true }).count(), 0);
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
    await page.getByRole('alert').getByText('Could not connect to the mail server. Check your internet connection and try again.', { exact: true }).waitFor();
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
    await page.locator('[data-preset="full"]').click();
    await preferences.getByLabel('Notify on completion', { exact: true }).check();
    await controls.getByRole('button', { name: 'Start backup', exact: true }).click();
    const savedBeforeStart = await page.evaluate(() => window.calls.lastIndexOf('save_backup_options') < window.calls.lastIndexOf('start_backup'));
    assert.equal(savedBeforeStart, true, 'The current selection is saved before backup starts');
    assert.equal(await page.evaluate(() => window.savedOptions.dateFrom), null);
    assert.equal(await page.evaluate(() => window.savedOptions.advanced.notifyOnSuccess), true, 'Notification preferences are applied to the started run');

    await page.waitForFunction(() => document.querySelector('.backup-controls [data-action="pause"]')?.disabled === false);
    await page.evaluate(() => { window.data.progress.downloaded = 2; document.dispatchEvent(new Event('visibilitychange')); });
    await page.waitForFunction(() => document.querySelector('.backup-page .run-stats dd')?.textContent === '2 / 4');
    await preferences.getByLabel('Sender contains', { exact: true }).fill('keep-draft@example.test');
    await page.evaluate(() => {
      window.data.localStats.messages = 5;
      window.data.localStats.folders = [{ name: 'INBOX', messages: 5 }];
      window.data.progress.processedMessages = 3;
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForFunction(() => document.querySelector('.folder-list button[data-folder=""] small')?.textContent === '5');
    assert.equal(await page.locator('.folder-row[data-folder="INBOX"] .folder-item small').textContent(), '5');
    assert.equal(await preferences.getByLabel('Sender contains', { exact: true }).inputValue(), 'keep-draft@example.test');
    assert.equal(await page.locator('.backup-progress-slot .run-progress').isVisible(), true);
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

    await page.locator('.run-banner').getByRole('heading', { name: 'Backup cancelled', exact: true }).waitFor();
    assert.equal(await page.locator('.backup-progress-slot .run-progress').isVisible(), true);
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
    await scheduler.getByRole('button', { name: 'Refresh folders', exact: true }).click();
    await scheduler.getByLabel('All mailbox folders', { exact: true }).uncheck();
    const folders = scheduler.getByRole('group', { name: 'Scheduled folders', exact: true });
    await folders.getByLabel('Sent', { exact: true }).check();
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
    assert.deepEqual(await page.evaluate(() => window.data.backupOptions.folders), [], 'Scheduled selection must not overwrite manual folders');
    assert.equal(await scheduler.getByText('Upcoming preview').count(), 0);
    await go('Preferences');
    const schedulePreferences = page.locator('#schedule-preferences-form');
    await schedulePreferences.getByLabel('Wake the computer to run', { exact: true }).check();
    await schedulePreferences.getByLabel('Restart attempts', { exact: true }).fill('2');
    await schedulePreferences.getByRole('button', { name: 'Save scheduled backup settings', exact: true }).click();
    await page.locator('#toast').getByText('Scheduled backup settings saved.', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.scheduleState.settings.wakeComputer), true);
    assert.equal(await page.evaluate(() => window.scheduleState.settings.restartCount), 2);
    assert.deepEqual(await page.evaluate(() => window.scheduleState.settings.folders), ['Sent'], 'Preferences keep the scheduled folders');
    assert.equal(await page.evaluate(() => window.scheduleState.settings.monthDay), 'last', 'Preferences keep the recurrence');
    await go('Scheduler');
    await scheduler.getByText('Windows: Ready', { exact: true }).waitFor();
    await scheduler.getByLabel('Enable scheduled backups', { exact: true }).uncheck();
    await scheduler.getByRole('button', { name: 'Save schedule', exact: true }).click();
    await scheduler.getByText('Windows: Disabled', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.scheduleState.settings.wakeComputer), true, 'Scheduler saves keep preference settings');
    await page.evaluate(() => { window.failSchedule = true; });
    await dismissToasts();
    await scheduler.getByRole('button', { name: 'Refresh status', exact: true }).click();
    await scheduler.getByText('Could not update the backup schedule. Check Windows Task Scheduler permissions and try again.', { exact: true }).waitFor();
    await page.evaluate(() => { window.failSchedule = false; });
    await scheduler.getByRole('button', { name: 'Remove schedule', exact: true }).click();
    await scheduler.getByText('Windows: Not installed', { exact: true }).waitFor();
    await go('Backup');
    assert.equal(await preferences.getByLabel('Sender contains', { exact: true }).inputValue(), 'draft@example.com', 'Manual option drafts survive other views');
    await preferences.getByRole('button', { name: 'Last 30 days', exact: true }).click();
    await preferences.getByLabel('Sender contains', { exact: true }).fill('billing@example.com');
    await preferences.getByText('Connection settings', { exact: true }).click();
    await preferences.getByLabel('Connection attempts', { exact: true }).fill('5');
    await preferences.getByLabel('Unread only', { exact: true }).check();
    await preferences.getByLabel('Notify on completion', { exact: true }).check();
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
    await runDetails.getByText('Something went wrong. Please try again. If the problem continues, restart Bmail.', { exact: true }).waitFor();
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
    await runDetails.getByText('Something went wrong. Please try again. If the problem continues, restart Bmail.', { exact: true }).waitFor();
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
    const sidebarWidth = async () => {
      await page.waitForFunction(() => {
        const layout = document.querySelector('.desktop-layout');
        return Math.abs(layout.querySelector('.folder-sidebar').getBoundingClientRect().width - parseFloat(layout.style.getPropertyValue('--sidebar-width'))) < .01;
      });
      return page.locator('.folder-sidebar').evaluate(el => el.getBoundingClientRect().width);
    };
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
    await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.folder-sidebar').getBoundingClientRect().width === 56);
    assert.equal(await page.getByRole('button', { name: 'Expand sidebar', exact: true }).getAttribute('aria-expanded'), 'false');
    assert.equal(await page.locator('#active-account').isVisible(), false);
    assert.equal(await sidebarDivider.getAttribute('aria-valuetext'), 'Collapsed, icons only');
    await page.getByRole('button', { name: 'Expand sidebar', exact: true }).focus();
    await page.evaluate(() => { window.sidebarControl = document.activeElement; });
    await refreshLocal();
    assert.equal(await page.evaluate(() => window.sidebarControl === document.querySelector('.sidebar-toggle') && window.sidebarControl === document.activeElement), true, 'Status polling preserves the sidebar control and its keyboard focus');
    const allFolders = sidebar.locator('[data-action="select-folder"][data-folder=""]');
    assert.equal(await allFolders.locator('svg').isVisible(), true);
    assert.equal(await allFolders.getAttribute('title'), 'All folders');
    await sidebar.locator('.folder-row .folder-item').first().click();
    assert.equal(await sidebarWidth(), 56, 'Folders remain usable without expanding the rail');
    await go('Activity'); await go('Home');
    assert.equal(await sidebarWidth(), 56, 'Collapsed state survives tab redraws');
    await page.reload();
    await page.getByRole('button', { name: 'Expand sidebar', exact: true }).waitFor();
    await page.waitForFunction(() => document.querySelector('.folder-sidebar').getBoundingClientRect().width === 56);
    if (process.env.BMAIL_SIDEBAR_SCREENSHOT) await page.screenshot({ path: process.env.BMAIL_SIDEBAR_SCREENSHOT });
    await page.getByRole('button', { name: 'Choose account', exact: true }).click();
    assert.equal(await page.locator('#active-account').evaluate(el => el === document.activeElement), true);
    assert.ok(Math.abs(await sidebarWidth() - storedSidebar) < 2, 'Expand restores the previous width');
    await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click();
    await page.getByRole('button', { name: 'Filter folders', exact: true }).click();
    assert.equal(await page.locator('#folder-filter').evaluate(el => el === document.activeElement), true);
    await sidebarWidth();
    const narrowBox = await sidebarDivider.boundingBox();
    await page.mouse.move(narrowBox.x + 3, narrowBox.y + 100); await page.mouse.down();
    await page.mouse.move(140, narrowBox.y + 100, { steps: 8 });
    const intermediate = await sidebarWidth();
    assert.ok(intermediate > 120 && intermediate < 150, `During a drag the width follows the pointer through the compact range (${intermediate}px)`);
    const fading = await page.locator('.desktop-layout').evaluate(el => Number(el.style.getPropertyValue('--sidebar-label-opacity')));
    assert.ok(fading > 0 && fading < 1, 'Labels progressively fade before icons-only mode');
    await page.mouse.move(90, narrowBox.y + 100, { steps: 8 });
    assert.ok(await sidebarWidth() > 56, 'The sidebar does not snap away from the pointer during the drag');
    await page.mouse.up();
    assert.equal(await sidebarWidth(), 56, 'Dragging narrow snaps to icons rather than clipped text');
    await sidebarDivider.focus(); await page.keyboard.press('ArrowRight');
    assert.equal(await sidebarWidth(), 160, 'Keyboard users can expand the rail');
    await page.keyboard.press('ArrowLeft');
    assert.equal(await sidebarWidth(), 56, 'Keyboard users can collapse the sidebar');
    await sidebarDivider.dblclick();
    assert.ok(await sidebarWidth() >= 160, 'Double-click restores the expanded default');
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
        { id: 'aaaaaaaa-1:42', uid: 42, file: '', folder: 'INBOX', subject: 'New server mail', sender: 'sender@example.test', isNew: true, onServer: true, backedUp: false },
        { id: 'server-old', file: '', folder: 'INBOX', subject: 'Existing server mail', sender: 'sender@example.test', isNew: false, onServer: true, backedUp: false },
        { id: 'saved-new', file: 'saved-new.eml', folder: 'INBOX', subject: 'New saved mail', sender: 'sender@example.test', isNew: true, onServer: true, backedUp: true },
      ];
    });
    await refreshLocal();
    await go('Home');
    const serverNew = page.locator('.mail-table tbody tr').filter({ hasText: 'New server mail' });
    await serverNew.waitFor();
    assert.equal(await serverNew.locator('.state-new').textContent(), 'New');
    assert.equal(await serverNew.locator('.state-not-backed-up').getAttribute('title'), 'Not backed up');
    assert.equal(await serverNew.locator('.state-not-backed-up').textContent(), '');
    assert.equal(await serverNew.locator('.download-icon').isDisabled(), true);
    await serverNew.locator('.mail-subject').click();
    await page.getByRole('region', { name: 'Email preview' }).getByRole('heading', { name: 'Not backed up', exact: true }).waitFor();
    const readerBackup = page.getByRole('region', { name: 'Email preview' }).getByRole('button', { name: 'Back up this email', exact: true });
    assert.equal(await readerBackup.locator('svg[aria-hidden="true"]').count(), 1, 'Unbacked messages show the backup action icon');
    await readerBackup.click();
    await page.waitForFunction(() => window.backupMessage?.uid === 42);
    assert.deepEqual(await page.evaluate(() => window.backupMessage), { folder: 'INBOX', uid: 42, uidValidity: '1' });
    assert.equal(await page.getByRole('tab', { name: 'Home', exact: true }).getAttribute('aria-selected'), 'true', 'Direct backup keeps the email open');
    assert.equal(await page.locator('.mail-table tbody tr').filter({ hasText: 'Existing server mail' }).locator('.state-new').count(), 0);
    assert.equal(await page.locator('.mail-table tbody tr').filter({ hasText: 'New saved mail' }).locator('.mail-state').count(), 2);
    if (process.env.BMAIL_MAIL_SCREENSHOT) await page.screenshot({ path: process.env.BMAIL_MAIL_SCREENSHOT });
    await page.evaluate(() => {
      const mail = window.data.localStats.recent.find(row => row.uid === 42);
      mail.backedUp = true; mail.file = 'emails/INBOX/selected.eml';
      window.data.backupRunning = false;
      window.data.lastRun = { runId: 'selected-mail-backup', success: true, downloaded: 1, finishedAt: new Date().toISOString() };
      window.data.progress = { state: 'completed' };
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.getByRole('region', { name: 'Email preview' }).getByRole('heading', { name: 'Preview subject', exact: true }).waitFor();
    await page.evaluate(() => sessionStorage.setItem('fixture-new-mail-failure', 'NEW_MAIL_CHECK_BUSY'));
    await page.reload();
    await page.waitForFunction(() => window.newMailChecks === 1 && document.querySelector('.status-message')?.textContent === '');
    assert.equal(await page.locator('.operation-error').count(), 0, 'Busy startup checks do not show a failure');
    assert.equal(await page.locator('#toast').textContent(), '');
    await page.evaluate(() => { window.newMailFailure = ''; document.dispatchEvent(new Event('visibilitychange')); });
    assert.equal(await page.evaluate(() => window.newMailChecks), 1, 'Busy retries respect their cooldown');
    await page.waitForFunction(() => window.newMailChecks === 2 && document.querySelector('.folder-row[data-folder="INBOX"] .new-mail-badge'));
    await page.evaluate(() => sessionStorage.setItem('fixture-new-mail-failure', 'Backup failed. No server emails were deleted.\n{"name":"Error","message":"connect ETIMEDOUT 204.79.197.210:993","code":"ETIMEDOUT"}'));
    await page.reload();
    await page.locator('.operation-error').getByText('The mail server took too long to respond. Check your internet connection and mailbox server settings, then try again.', { exact: true }).waitFor();
    assert.doesNotMatch(await page.locator('body').innerText(), /ETIMEDOUT|204\.79\.197\.210|\"name\":\"Error\"/);
    await page.evaluate(() => { window.newMailFailure = ''; sessionStorage.removeItem('fixture-new-mail-failure'); });
    await page.locator('.operation-error').getByRole('button', { name: 'Retry', exact: true }).click();
    await page.waitForFunction(() => window.newMailChecks === 2 && !document.querySelector('.operation-error') && document.querySelector('.folder-row[data-folder="INBOX"] .new-mail-badge'));
    await page.locator('[data-action="add-account"]').click();
    await page.locator('#mail-provider').selectOption('outlook');
    assert.equal(await page.locator('#mail-host').inputValue(), 'outlook.office365.com');
    assert.equal(await page.locator('#mail-port').inputValue(), '993');
    assert.equal(await page.locator('#mail-password').isVisible(), false);
    assert.equal(await page.locator('label[for="mail-password"]').isVisible(), false);
    await page.locator('#mail-user').fill('fixture@outlook.com');
    assert.equal(await page.locator('#outlook-client-id').count(), 0);
    await page.locator('#mailbox-form [type="submit"]').click();
    await page.getByText('Start Microsoft sign-in first.', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Sign in with Microsoft', exact: true }).click();
    await page.locator('#outlook-sign-in-status').filter({ hasText: 'TEST-CODE' }).waitFor();
    await page.locator('#mailbox-form [type="submit"]').click();
    await page.waitForFunction(() => window.mailboxSettings?.device_code === 'fixture-device');
    assert.deepEqual(await page.evaluate(() => window.mailboxSettings), {
      user: 'fixture@outlook.com', host: 'outlook.office365.com', port: 993,
      password: '', device_code: 'fixture-device', device_interval: 5,
    });
    await page.waitForFunction(() => !document.querySelector('#mailbox-dialog').open);
    await page.evaluate(() => { window.data.host = 'outlook.in'; window.data.hasManifest = false; });
    await refreshLocal();
    await page.locator('[data-action="setup"]').first().click();
    assert.equal(await page.locator('#mail-provider').inputValue(), 'outlook');
    assert.equal(await page.locator('#mail-host').inputValue(), 'outlook.office365.com');
    assert.equal(await page.locator('#mail-password').isVisible(), false);
    await page.getByText('The saved server was an Outlook email domain.', { exact: false }).waitFor();
    assert.match(await page.locator('#provider-help').textContent(), /password is entered only on the Microsoft/);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.locator('[data-action="add-account"]').click();
    await page.locator('#mail-provider').selectOption('other');
    await page.locator('#mail-host').fill('outlook.in');
    await page.locator('#mail-host').press('Tab');
    assert.equal(await page.locator('#mail-provider').inputValue(), 'outlook');
    assert.equal(await page.locator('#mail-host').inputValue(), 'outlook.office365.com');
    assert.equal(await page.locator('#mail-password').isVisible(), false);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await dismissToasts();
    await page.evaluate(() => {
      window.dispatchEvent(new PromiseRejectionEvent('unhandledrejection', { promise: Promise.resolve(), reason: new Error('private-runtime-stack 204.79.197.210:993') }));
    });
    await page.locator('#toast .toast-message').getByText('Something went wrong. Please try again. If the problem continues, restart Bmail.', { exact: true }).waitFor();
    assert.doesNotMatch(await page.locator('body').innerText(), /private-runtime-stack|204\.79\.197\.210/);
    await page.evaluate(() => {
      document.querySelector('#toast').remove();
      window.dispatchEvent(new ErrorEvent('error', { error: new Error('private-startup-error'), message: 'private-startup-error' }));
    });
    await page.getByRole('heading', { name: 'Bmail needs your attention' }).waitFor();
    assert.doesNotMatch(await page.locator('body').innerText(), /private-startup-error/);
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await page.locator('#active-account').waitFor();
    await page.evaluate(() => sessionStorage.setItem('fixture-microsoft-unavailable', 'true'));
    await page.reload();
    await page.locator('[data-action="add-account"]').click();
    await page.locator('#mail-provider').selectOption('outlook');
    await page.locator('#outlook-availability').filter({ hasText: 'Outlook accounts cannot be connected yet.' }).waitFor();
    assert.equal(await page.locator('#outlook-client-id').count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Sign in with Microsoft', exact: true }).isDisabled(), true);
    assert.equal(await page.locator('#mailbox-form [type="submit"]').isDisabled(), true);
    await page.locator('#mail-provider').selectOption('google');
    assert.equal(await page.locator('#mailbox-form [type="submit"]').isDisabled(), false);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.equal(await page.locator('body').evaluate(element => element.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))), false);
    await page.locator('[data-action="notifications-open"]').click();
    await page.locator('#notification-dialog').waitFor();
    assert.equal(await page.locator('#notification-dialog').evaluate(element => element.matches(':modal')), false);
    await page.locator('[data-action="notifications-open"]').click();
    await page.locator('#notification-dialog').waitFor({ state: 'hidden' });
    await page.locator('[data-action="notifications-open"]').click();
    await page.keyboard.press('Escape');
    await page.locator('#notification-dialog').waitFor({ state: 'hidden' });
    await page.evaluate(() => {
      window.data.lastRun = { runId: 'instant-backup', outcome: 'completed', success: true, downloaded: 0, finishedAt: new Date().toISOString() };
      window.data.backupRunning = false;
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('bmail-notifications') || '[]').some(item => item.key === 'backup:instant-backup:completed'));
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('bmail-notifications')).every(item => item.key?.startsWith('mail:') || item.key?.startsWith('backup:') && item.key.endsWith(':completed'))), true);
    await go('Home');
    await go('Preferences');
    const cloud = page.locator('#cloud-backup-settings');
    const cloudGroup = page.getByRole('region', { name: 'Cloud backup', exact: true });
    assert.equal(await cloudGroup.getByRole('article').count(), 2, 'Both providers belong to the single Cloud backup section');
    assert.equal(await page.getByRole('heading', { name: 'Cloud backup', exact: true }).count(), 1);
    assert.equal(await page.locator('.preferences-header p').count(), 0, 'Preferences has no introductory filler');
    assert.equal(await cloudGroup.locator('img').count(), 2);
    await page.waitForFunction(() => [...document.querySelectorAll('.cloud-provider img')].every(img => img.complete && img.naturalWidth > 0));
    await cloud.getByRole('button', { name: 'Set up Google Drive', exact: true }).click();
    await cloud.getByRole('button', { name: 'Connect Google Drive', exact: true }).click();
    await cloud.getByText('drive-fixture@example.test', { exact: true }).waitFor();
    await cloud.getByLabel('Upload to Drive after successful local backups', { exact: true }).check();
    await page.waitForFunction(() => window.data.cloudDrive.automatic === true);
    await page.evaluate(() => { window.holdDrive = true; });
    await cloud.getByRole('button', { name: 'Back up to Drive now', exact: true }).click();
    await page.waitForFunction(() => Boolean(window.finishDrive));
    await cloud.getByRole('progressbar', { name: 'Google Drive backup progress', exact: true }).waitFor();
    await go('Home'); await go('Preferences');
    assert.equal(await cloud.getByRole('button', { name: 'Uploading…', exact: true }).isDisabled(), true);
    await page.evaluate(() => { window.holdDrive = false; window.finishDrive(); });
    await cloud.getByRole('button', { name: 'Back up to Drive now', exact: true }).waitFor();
    await cloud.getByText('Last backup', { exact: true }).waitFor();
    await page.evaluate(() => { window.failDrive = true; });
    await cloud.getByRole('button', { name: 'Back up to Drive now', exact: true }).click();
    await cloud.getByRole('alert').filter({ hasText: 'Google Drive storage or request quota was exceeded.' }).waitFor();
    await cloud.getByRole('button', { name: 'Disconnect', exact: true }).click();
    await cloud.getByRole('button', { name: 'Connect Google Drive', exact: true }).waitFor();
    assert.equal(await cloud.getByLabel('Upload to Drive after successful local backups', { exact: true }).isChecked(), false);
    const dropbox = page.locator('#dropbox-backup-settings');
    await dropbox.getByRole('button', { name: 'Connect Dropbox', exact: true }).click();
    await dropbox.getByText('dropbox-fixture@example.test', { exact: true }).waitFor();
    await dropbox.getByLabel('Upload to Dropbox after successful local backups', { exact: true }).check();
    await page.waitForFunction(() => window.data.cloudDropbox.automatic === true);
    assert.equal(await page.evaluate(() => window.data.cloudDrive.automatic), false, 'Provider preferences are independent');
    await page.evaluate(() => { window.holdDropbox = true; });
    await dropbox.getByRole('button', { name: 'Back up to Dropbox now', exact: true }).click();
    await page.waitForFunction(() => Boolean(window.finishDropbox));
    await dropbox.getByRole('progressbar', { name: 'Dropbox backup progress', exact: true }).waitFor();
    await go('Home'); await go('Preferences');
    assert.equal(await dropbox.getByRole('button', { name: 'Uploading to Dropbox…', exact: true }).isDisabled(), true);
    await page.evaluate(() => { window.holdDropbox = false; window.finishDropbox(); });
    await dropbox.getByText('Last backup', { exact: true }).waitFor();
    await page.evaluate(() => { window.failDropbox = true; });
    await dropbox.getByRole('button', { name: 'Back up to Dropbox now', exact: true }).click();
    await dropbox.getByRole('alert').filter({ hasText: 'Dropbox storage or request limits were reached.' }).waitFor();
    await dropbox.getByRole('button', { name: 'Disconnect Dropbox', exact: true }).click();
    await dropbox.getByRole('button', { name: 'Connect Dropbox', exact: true }).waitFor();
    assert.equal(await dropbox.getByLabel('Upload to Dropbox after successful local backups', { exact: true }).isChecked(), false);
    await go('Home');
    const activityBounds = await tab('Activity').boundingBox();
    await page.mouse.move(activityBounds.x + activityBounds.width / 2, activityBounds.y + activityBounds.height / 2);
    await page.mouse.down();
    await page.evaluate(() => {
      window.pressedTab = document.querySelector('#tab-activity');
      window.data.localStats.bytes++;
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForTimeout(150);
    assert.equal(await page.evaluate(() => window.pressedTab.isConnected), true, 'Refreshing while a tab is pressed must preserve the click target');
      await page.evaluate(() => {
        // Force a dashboard response into the release/click gap, which a
        // normal browser mouse.up dispatches too quickly to reproduce reliably.
        window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1 }));
        window.data.localStats.bytes++;
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await page.waitForTimeout(100);
      assert.equal(await page.evaluate(() => window.pressedTab.isConnected), true, 'A refresh after release must still preserve the first click target');
    await page.mouse.up();
    await page.getByRole('tabpanel', { name: 'Activity', exact: true }).waitFor();
    await go('Home');
    await page.evaluate(() => { window.holdCheck = true; });
    await page.getByRole('button', { name: 'Sync', exact: true }).click();
    await page.waitForFunction(() => Boolean(window.finishCheck));
    assert.equal(await tab('Activity').isEnabled(), true, 'A slow mailbox check must not lock navigation');
    await go('Activity');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    await page.getByRole('tabpanel', { name: 'Preferences', exact: true }).waitFor();
    await go('Home');
    await back.click();
    await page.getByRole('tabpanel', { name: 'Preferences', exact: true }).waitFor();
    await page.evaluate(() => { window.holdCheck = false; window.finishCheck(); });
    await page.waitForFunction(() => !document.querySelector('[data-action="stats"]').disabled);
    await page.getByRole('button', { name: 'Search Bmail', exact: true }).click();
    const search = page.getByRole('dialog', { name: 'Search Bmail', exact: true });
    await search.waitFor();
    const searchBox = search.getByRole('searchbox');
    await search.getByRole('button', { name: 'Settings', exact: true }).click();
    await searchBox.fill('dark');
    await search.locator('[data-result]').filter({ hasText: 'Theme' }).click();
    await page.waitForFunction(() => document.activeElement?.id === 'theme-preference');
    await page.keyboard.press('Control+k');
    await search.waitFor();
    await search.getByRole('button', { name: 'Features', exact: true }).click();
    await searchBox.fill('calendar');
    await search.locator('[data-result]').filter({ hasText: 'Scheduler' }).waitFor();
    await page.keyboard.press('Escape');
    await search.waitFor({ state: 'hidden' });
    await page.evaluate(() => {
      window.data.localStats.recent = Array.from({ length: 80 }, (_, i) => ({ file: `emails/INBOX/${i}.eml`, folder: 'INBOX', subject: i === 79 ? '<img src=x onerror="window.injected=true"> needle' : `Other ${i}`, sender: 'search@example.test', backedUp: true }));
    });
    await page.getByRole('button', { name: 'Search Bmail', exact: true }).click();
    await search.getByRole('button', { name: 'Mails', exact: true }).click();
    await searchBox.fill('needle');
    await search.locator('[data-result]').filter({ hasText: 'needle' }).waitFor();
    assert.equal(await search.locator('[data-result]').count(), 1, 'Search reaches mail beyond the first page');
    assert.equal(await search.locator('img').count(), 0, 'Search escapes message subjects');
    await search.locator('[data-result]').click();
    await page.getByRole('region', { name: 'Email preview' }).getByRole('heading', { name: 'Preview subject', exact: true }).waitFor();
    await page.keyboard.press('Control+k');
    await searchBox.fill('no matching result anywhere');
    await search.getByText('No matches. Try another word or filter.', { exact: true }).waitFor();
    const bounds = await search.boundingBox();
    const viewport = page.viewportSize();
    assert.ok(Math.abs(bounds.x + bounds.width / 2 - viewport.width / 2) < 3, 'Search popup is centered');
    await page.keyboard.press('Escape');
    assert.deepEqual(errors, []);
    assert.equal(await page.locator('.statusbar progress').count(), 0, 'Finished runs clear the status progress bar');
    console.log('Tabbed workspace passed: no duplicate panels, keyboard tabs, retained drafts, independent scheduled folders, calendar, retries, history, notifications and responsive layout.');
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
