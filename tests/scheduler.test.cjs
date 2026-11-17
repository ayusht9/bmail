const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { normalizeSelection, searchForSelection, scheduledSelection } = require('../engine/backup-selection.cjs');
const { recordRun, notifyRun } = require('../engine/backup-history.cjs');
const { atomicWrite, readJson } = require('../engine/backup.cjs');

test('calendar preview handles intervals, selected weekdays, leap years, month ends and expired schedules', async () => {
  const { defaultSchedule, normalizeSchedule, nextRuns, localDate } = await import('../src/scheduler.js');
  const now = new Date('2032-01-01T09:00:00');
  const base = { ...defaultSchedule(now), startDate: '2032-01-01', time: '11:00' };
  let schedule = normalizeSchedule({ ...base, frequency: 'daily', every: 2 }, now);
  assert.deepEqual(nextRuns(schedule, now, 3).map(localDate), ['2032-01-01', '2032-01-03', '2032-01-05']);
  schedule = normalizeSchedule({ ...base, frequency: 'monthly', monthDay: 'last' }, now);
  assert.deepEqual(nextRuns(schedule, now, 3).map(localDate), ['2032-01-31', '2032-02-29', '2032-03-31']);
  schedule = normalizeSchedule({ ...base, frequency: 'monthly', monthDay: '31' }, now);
  assert.deepEqual(nextRuns(schedule, now, 3).map(localDate), ['2032-01-31', '2032-03-31', '2032-05-31']);
  schedule = normalizeSchedule({ ...base, frequency: 'weekly', weekdays: [1, 5] }, now);
  assert.ok(nextRuns(schedule, now, 6).every(date => [1, 5].includes(date.getDay())));
  schedule = normalizeSchedule({ ...base, frequency: 'interval', intervalHours: 6 }, now);
  const runs = nextRuns(schedule, new Date('2032-01-02T12:00:00'), 2);
  assert.equal(runs[0].getHours(), 17);
  assert.equal(runs[1] - runs[0], 6 * 3600000);
  assert.deepEqual(nextRuns({ ...schedule, enabled: false }, now), []);
  assert.throws(() => normalizeSchedule({ ...base, frequency: 'weekly', weekdays: [] }, now), /weekday/);
  assert.throws(() => normalizeSchedule({ ...base, frequency: 'once', startDate: '2031-12-01' }, now), /future/);
  assert.throws(() => normalizeSchedule({ ...base, endDate: '2031-12-31' }, now), /end date/);
  assert.throws(() => normalizeSchedule({ ...base, frequency: 'weekly', every: 53 }, now), /every/);
  assert.throws(() => normalizeSchedule({ ...base, time: '25:00' }, now), /time/);
});

test('advanced filters produce read-only IMAP criteria and validate ranges and recovery settings', () => {
  const selection = normalizeSelection({ advanced: { unreadOnly: true, flaggedOnly: true, sender: 'billing@example.com', subject: 'Invoice', lastDays: 7,
    minSizeKB: 10, maxSizeMB: 5, order: 'oldest', retryAttempts: 5, retryDelaySeconds: 10 } });
  const query = searchForSelection(selection, new Date('2032-02-10T15:00:00Z'));
  assert.equal(query.since.toISOString(), '2032-02-04T00:00:00.000Z');
  assert.equal(query.seen, false); assert.equal(query.flagged, true);
  assert.equal(query.from, 'billing@example.com'); assert.equal(query.subject, 'Invoice');
  assert.equal(query.larger, 10239); assert.equal(query.smaller, 5 * 1048576 + 1);
  assert.throws(() => normalizeSelection({ dateFrom: '2032-01-01', advanced: { lastDays: 7 } }), /rolling/);
  assert.throws(() => normalizeSelection({ advanced: { minSizeKB: 2048, maxSizeMB: 1 } }), /Minimum/);
  assert.throws(() => normalizeSelection({ advanced: { retryAttempts: 0 } }), /retryAttempts/);
  assert.throws(() => normalizeSelection({ advanced: { sender: 'bad\r\nfilter' } }), /filter/);
  assert.throws(() => normalizeSelection({ advanced: { verifyAfterBackup: 'false' } }), /verifyAfterBackup/);
});

test('Windows schedule XML and persistence support all recurrences and keep accounts isolated', { skip: process.platform !== 'win32' }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bmail-scheduler-'));
  const probe = path.join(root, 'probe.ps1');
  fs.writeFileSync(probe, `
    $ErrorActionPreference = 'Stop'
    . (Join-Path $env:BMAIL_SOURCE_ROOT 'Backup-Schedule.ps1')
    function Assert-That { param($Value, $Message) if (-not $Value) { throw $Message } }
    $script:tasks = @{}
    $script:xmls = @{}
    function Register-ScheduledTask {
      [CmdletBinding()] param($TaskName,$TaskPath,$Xml,[switch]$Force)
      $doc = [xml]$Xml
      Assert-That ($doc.Task.Principals.Principal.RunLevel -eq 'LeastPrivilege') 'Task must not request elevation'
      Assert-That ($doc.Task.Principals.Principal.LogonType -eq 'InteractiveToken') 'Do not store a Windows password'
      Assert-That ($doc.Task.Settings.MultipleInstancesPolicy -eq 'IgnoreNew') 'Overlaps must be ignored'
      $script:xmls[$TaskName] = $doc
      $script:tasks[$TaskName] = [pscustomobject]@{TaskName=$TaskName;TaskPath='\\';State='Ready';Settings=[pscustomobject]@{Enabled=($doc.Task.Settings.Enabled -eq 'true')}}
      return $script:tasks[$TaskName]
    }
    function Get-ScheduledTask { [CmdletBinding()] param($TaskName,$TaskPath) return $script:tasks[$TaskName] }
    function Get-ScheduledTaskInfo { param($InputObject) return [pscustomobject]@{NextRunTime=[datetime]'2035-01-01';LastRunTime=[datetime]::MinValue;LastTaskResult=0} }
    function Unregister-ScheduledTask { [CmdletBinding(SupportsShouldProcess)] param([Parameter(ValueFromPipeline)]$InputObject) process { $script:tasks.Remove($InputObject.TaskName) } }
    $data = Join-Path $env:BMAIL_TEST_ROOT "Account's data & spaces"
    $other = Join-Path $env:BMAIL_TEST_ROOT 'Other account'
    New-Item -ItemType Directory -Path $data,$other -Force | Out-Null
    $held = Enter-BmailScheduleLock $data
    $blocked = $false
    try { $secondLock = Enter-BmailScheduleLock $data; $secondLock.Dispose() } catch { $blocked = $true } finally { $held.Dispose() }
    Assert-That $blocked 'Schedule updates must hold an exclusive account lock'
    foreach ($frequency in @('once','daily','weekly','monthly','interval')) {
      $raw = [pscustomobject](Get-BmailScheduleDefaults)
      $raw.allFolders=$false; $raw.folders=@('INBOX','Sent'); $raw.frequency = $frequency; $raw.startDate = '2035-01-01'; $raw.time='13:45'; $raw.weekdays=@(1,3,5); $raw.monthDay='last'; $raw.restartCount=2; $raw.wakeComputer=$true
      $result = Save-BmailSchedule $data $env:BMAIL_SOURCE_ROOT 'first@example.com' $raw
      Assert-That $result.installed 'Task registration did not persist'
      Assert-That (-not $result.settings.allFolders -and $result.settings.folders.Count -eq 2) 'Scheduled folders were not persisted'
      Assert-That ((Get-Content -LiteralPath (Join-Path $data 'Scheduled-Backup.ps1') -Raw).Contains('-Scheduled')) 'Launcher must use scheduled folder preferences'
      Assert-That ($result.settings.frequency -eq $frequency) 'Recurrence not saved'
      $xml = $script:xmls[(Get-BmailTaskName 'first@example.com')]
      Assert-That ($xml.Task.Actions.Exec.Arguments.Contains("Account's data & spaces")) 'Action path was not escaped correctly'
      Assert-That ($xml.Task.Settings.WakeToRun -eq 'true') 'Wake option was ignored'
      Assert-That ($xml.Task.Settings.RestartOnFailure.Count -eq '2') 'Recovery option was ignored'
      if ($frequency -eq 'monthly') { Assert-That ($xml.Task.Triggers.CalendarTrigger.ScheduleByMonth.DaysOfMonth.Day -eq 'Last') 'Monthly last day was not generated' }
      if ($frequency -eq 'interval') { Assert-That ($xml.Task.Triggers.TimeTrigger.Repetition.Interval -eq 'PT6H') 'Interval was ignored' }
      if ($frequency -eq 'weekly') { Assert-That ($null -ne $xml.Task.Triggers.CalendarTrigger.ScheduleByWeek.DaysOfWeek.Wednesday) 'Selected weekdays were ignored' }
    }
    $paused = [pscustomobject](Get-BmailScheduleDefaults); $paused.enabled=$false
    $second = Save-BmailSchedule $other $env:BMAIL_SOURCE_ROOT 'second@example.com' $paused
    Assert-That (-not $second.enabled) 'Pause was ignored'
    Assert-That ((Get-BmailScheduleStatus $data 'first@example.com').enabled) 'Pausing another account changed the first'
    $before = Get-Content -LiteralPath (Join-Path $data 'backup-schedule.json') -Raw
    $invalid = [pscustomobject](Get-BmailScheduleDefaults); $invalid.time='99:00'
    $failed = $false; try { Save-BmailSchedule $data $env:BMAIL_SOURCE_ROOT 'first@example.com' $invalid } catch { $failed=$true }
    Assert-That $failed 'Invalid time was accepted'
    Assert-That ((Get-Content -LiteralPath (Join-Path $data 'backup-schedule.json') -Raw) -eq $before) 'Invalid save modified the settings'
    Write-Output 'Schedule provider, XML, recurrence validation and account isolation passed'
  `);
  try {
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', probe], {
      env: { ...process.env, BMAIL_SOURCE_ROOT: path.resolve('engine'), BMAIL_TEST_ROOT: root }, encoding: 'utf8', windowsHide: true, timeout: 30000,
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /account isolation passed/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('schedule status is readable through the real Windows launcher without registering a task', { skip: process.platform !== 'win32' }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bmail-schedule-read-'));
  try {
    fs.writeFileSync(path.join(root, 'backup-config.json'), JSON.stringify({ user: `fixture-${path.basename(root)}@example.test` }));
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.resolve('engine/Manage-BackupSchedule.ps1')],
      { input: JSON.stringify({ action: 'read' }), env: { ...process.env, MAIL_VAULT_DATA_DIR: root }, encoding: 'utf8', windowsHide: true, timeout: 30000 });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const status = JSON.parse(result.stdout.replace(/^\uFEFF/, ''));
    assert.equal(status.installed, false); assert.equal(status.enabled, false);
    assert.equal(status.state, 'Not installed'); assert.ok(status.checkedAt); assert.ok(status.timeZone);
    assert.ok(fs.existsSync(path.join(root, 'backup-schedule-status.json')));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('history is bounded, updates repeated run IDs and preserves an unreadable existing file', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bmail-history-'));
  const file = path.join(root, 'history.json');
  const helpers = { atomicWrite, readJson };
  try {
    atomicWrite(file, JSON.stringify(Array.from({ length: 500 }, (_, index) => ({ runId: `old-${index}` }))));
    const status = { runId: 'new', startedAt: '2032-01-01T00:00:00Z', finishedAt: '2032-01-01T00:02:00Z', success: false, downloaded: 2 };
    recordRun(root, status, {}, helpers);
    let history = readJson(file);
    assert.equal(history.length, 500); assert.equal(history[0].durationSeconds, 120);
    recordRun(root, { ...status, success: true, downloaded: 3 }, {}, helpers);
    history = readJson(file);
    assert.equal(history.length, 500); assert.equal(history[0].downloaded, 3); assert.equal(history[0].outcome, 'completed');
    fs.writeFileSync(file, '{invalid history');
    assert.throws(() => recordRun(root, status, {}, helpers));
    assert.equal(fs.readFileSync(file, 'utf8'), '{invalid history');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('notification preferences route only enabled outcomes and do not expose credentials or error contents', { skip: process.platform !== 'win32' }, async () => {
  const { EventEmitter } = require('node:events');
  const { Writable } = require('node:stream');
  const payloads = [];
  const launch = (command, args, options) => {
    assert.equal(command, 'powershell.exe'); assert.ok(args.includes('-STA')); assert.equal(options.windowsHide, true);
    const child = new EventEmitter();
    child.stdin = new Writable({ write(chunk, encoding, callback) { payloads.push(JSON.parse(chunk.toString())); callback(); } });
    child.stdin.on('finish', () => child.emit('close', 0));
    return child;
  };
  const config = { user: 'fixture@example.com', password: 'do-not-notify-this' };
  await notifyRun(config, { success: true, downloaded: 2 }, {}, launch);
  assert.equal(payloads.length, 0);
  await notifyRun(config, { success: true, downloaded: 2 }, { notifyOnSuccess: true }, launch);
  await notifyRun(config, { success: false, error: { message: config.password } }, { notifyOnFailure: true }, launch);
  await notifyRun(config, { outcome: 'cancelled', downloaded: 1 }, { notifyOnStopped: true }, launch);
  assert.equal(payloads.length, 3); assert.equal(payloads[1].failed, true);
  assert.ok(!JSON.stringify(payloads).includes(config.password));
  const checked = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-File', path.resolve('engine/Notify-Backup.ps1'), '-ValidateOnly'],
    { input: JSON.stringify(payloads[0]), encoding: 'utf8', windowsHide: true, timeout: 10000 });
  assert.equal(checked.status, 0, checked.stderr || checked.stdout);
});

 test('scheduled folders override only manual folders without changing saved preferences', () => {
  const manual = { folders: ['INBOX'], maxMessages: 25, advanced: { sender: 'billing@example.com' } };
  const before = JSON.stringify(manual);
  const selected = scheduledSelection(manual, { enabled: true, allFolders: false, folders: ['Sent'] });
  assert.deepEqual(selected.folders, ['Sent']);
  assert.equal(selected.maxMessages, 25);
  assert.equal(selected.advanced.sender, 'billing@example.com');
  assert.equal(JSON.stringify(manual), before);
  assert.deepEqual(scheduledSelection(manual, { enabled: true, allFolders: true, folders: [] }).folders, []);
  assert.equal(scheduledSelection(manual, { enabled: false }), null);
  assert.throws(() => scheduledSelection(manual, { enabled: true, allFolders: false, folders: [] }), /at least one/);
});
