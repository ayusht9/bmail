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
      window.dashboardForces = [];
      window.failCheck = false;
      window.failSchedule = false;
      window.scheduleState = { installed: false, enabled: false, state: 'Not installed', settings: null, checkedAt: new Date().toISOString() };
      window.data = { user: 'fixture@example.com', accounts: ['fixture@example.com'], host: 'imap.gmail.com', port: 993,
        credentialReady: true, hasManifest: true, backupRunning: false, backupOptions: { folders: ['INBOX'] }, folderCount: 1,
        localStats: { messages: 3, bytes: 1048576, folders: [{ name: 'INBOX', messages: 3 }], recent: [
          { subject: '<img src=x onerror="window.injected=true">', sender: 'fixture@example.com', folder: 'INBOX', backedUpAt: '2026-11-15T00:00:00Z' },
        ] }, lastRun: { success: true, downloaded: 1, finishedAt: '2026-11-15T00:00:00Z' } };
      window.__TAURI_INTERNALS__ = { invoke: async (name, args) => {
        window.calls.push(name);
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
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const tab = name => page.getByRole('tab', { name, exact: true });
    const go = async name => { await tab(name).click(); await page.getByRole('tabpanel', { name, exact: true }).waitFor(); };
    const sidebar = page.getByRole('navigation', { name: 'Mailbox folders' });
    assert.equal(await page.getByRole('tab').count(), 6);
    assert.equal(await page.locator('[role="tabpanel"]:not([hidden])').count(), 1);
    assert.equal(await page.locator('.selection-summary,.storage-summary,.inspector').count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Open backup folder', exact: true }).count(), 1);
    assert.equal(await page.getByRole('button', { name: 'Choose what to back up', exact: true }).count(), 0);
    const recent = page.getByRole('region', { name: 'Recently saved mail' });
    await recent.waitFor();
    assert.match(await recent.textContent(), /<img/);
    assert.equal(await page.evaluate(() => window.injected), undefined);
    await sidebar.getByRole('button', { name: 'INBOX 3', exact: true }).click();
    await page.getByRole('heading', { name: 'INBOX', level: 1 }).waitFor();
    const filter = page.getByRole('searchbox', { name: 'Filter folders' });
    await filter.fill('does-not-exist');
    assert.equal(await page.locator('.folder-table tbody button').count(), 0);
    await filter.fill('in'); await filter.press('Home');
    await page.evaluate(() => { window.data.localStats.bytes = 2097152; window.data.mailboxes = { folders: ['INBOX','Sent','Archive','Incoming'] }; document.dispatchEvent(new Event('visibilitychange')); });
    await sidebar.getByRole('button', { name: 'Incoming 0', exact: true }).waitFor();
    await page.keyboard.type('x');
    assert.equal(await filter.inputValue(), 'xin'); await filter.fill('');
    if (process.env.BMAIL_UI_SCREENSHOT) await page.screenshot({ path: process.env.BMAIL_UI_SCREENSHOT });
    await go('Overview');
    const panel = page.getByRole('region', { name: 'Backup statistics' });
    await panel.getByRole('heading', { name: 'Full backup not checked yet' }).waitFor();
    assert.equal(await panel.getByText('2.0 MB', { exact: true }).count(), 1);
    await page.getByRole('button', { name: 'Check mailbox', exact: true }).click();
    await panel.getByRole('heading', { name: 'Full mailbox backed up at last check' }).waitFor();
    assert.equal(await panel.getByRole('progressbar').getAttribute('value'), '100');
    await page.evaluate(() => { window.data.mailboxStatus.complete = false; window.data.mailboxStatus.missingMessages = 2; window.data.mailboxStatus.totalServerMessages = 5; });
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await panel.getByRole('heading', { name: 'Mailbox backup is incomplete' }).waitFor();
    assert.equal(await page.evaluate(() => window.dashboardForces.at(-1)), true);
    await page.evaluate(() => { window.failCheck = true; });
    await page.getByRole('button', { name: 'Check mailbox', exact: true }).click();
    await page.getByRole('alert').getByText('Connection failed', { exact: true }).waitFor();
    await go('Mailbox');
    assert.equal(await page.getByRole('alert').isVisible(), true);
    await page.evaluate(() => { window.failCheck = false; });
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await page.getByRole('alert').waitFor({ state: 'hidden' });
    // Tabs use manual keyboard activation and do not fetch data on arrow focus.
    await tab('Mailbox').focus(); await tab('Mailbox').press('ArrowRight');
    assert.equal(await tab('Overview').evaluate(element => element === document.activeElement), true);
    assert.equal(await tab('Mailbox').getAttribute('aria-selected'), 'true');
    await page.keyboard.press('Enter'); await panel.waitFor();
    await go('Backup options');
    const preferences = page.locator('#selection-panel');
    await preferences.getByText('Advanced backup options', { exact: true }).click();
    await preferences.getByLabel('Sender contains', { exact: true }).fill('draft@example.com');
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
    await go('History'); await go('Scheduler');
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
    await scheduler.getByRole('button', { name: 'Refresh status', exact: true }).click();
    await scheduler.getByText('Windows scheduler unavailable', { exact: true }).waitFor();
    await page.evaluate(() => { window.failSchedule = false; });
    await scheduler.getByRole('button', { name: 'Remove schedule', exact: true }).click();
    await scheduler.getByText('Windows: Not installed', { exact: true }).waitFor();
    await go('Backup options');
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
    await page.getByRole('button', { name: 'Refresh', exact: true }).click(); await go('History');
    const history = page.getByRole('region', { name: 'Backup history' });
    assert.equal(await history.locator('tbody tr').count(), 2);
    await history.locator('#history-filter').selectOption('failed');
    assert.equal(await history.locator('tbody tr').count(), 1);
    await history.getByText(/historyInjection/).waitFor();
    assert.equal(await history.locator('script').count(), 0);
    await go('Activity'); await page.getByRole('region', { name: 'Activity log' }).waitFor();
    assert.equal(await page.locator('.history-pane').count(), 0);
    await page.evaluate(() => { window.data.backupRunning = true; });
    await page.getByRole('button', { name: 'Refresh', exact: true }).click(); await go('Overview');
    await panel.getByRole('heading', { name: 'Backup in progress' }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Check mailbox', exact: true }).isDisabled(), true);
    for (const size of [{ width: 1120, height: 780 }, { width: 760, height: 620 }]) {
      await page.setViewportSize(size);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'No horizontal window overflow');
      assert.equal(await page.locator('[role="tabpanel"]:not([hidden])').count(), 1);
    }
    assert.deepEqual(errors, []);
    console.log('Tabbed workspace passed: no duplicate panels, keyboard tabs, retained drafts, independent scheduled folders, calendar, retries, history, notifications and responsive layout.');
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
