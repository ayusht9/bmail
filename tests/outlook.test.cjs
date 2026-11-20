const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const psQuote = value => "'" + value.replaceAll("'", "''") + "'";

test('Microsoft device polling honors pending, slow-down, and denial without exposing responses', { skip: process.platform !== 'win32' }, () => {
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `
    $ErrorActionPreference = 'Stop'
    . ${psQuote(path.resolve('engine/Outlook-Auth.ps1'))}
    $script:attempt = 0
    $script:delays = @()
    function Start-Sleep { param($Seconds) $script:delays += $Seconds }
    function Invoke-RestMethod {
      param($Uri, $Method, $Body, $TimeoutSec)
      if ($Body.grant_type -ne 'urn:ietf:params:oauth:grant-type:device_code') { throw 'wrong grant' }
      $script:attempt++
      if ($script:attempt -le 2) {
        $errorCode = if ($script:attempt -eq 1) { 'authorization_pending' } else { 'slow_down' }
        $err = [Management.Automation.ErrorRecord]::new([Exception]::new('fixture'), 'fixture', [Management.Automation.ErrorCategory]::InvalidOperation, $null)
        $err.ErrorDetails = [Management.Automation.ErrorDetails]::new(('{"error":"' + $errorCode + '"}'))
        throw $err
      }
      return @{ access_token = 'fixture-access'; refresh_token = 'fixture-refresh' }
    }
    $tokens = Wait-OutlookToken -ClientId '11111111-1111-1111-1111-111111111111' -DeviceCode 'fixture-device' -Interval 12
    if ($tokens.refresh_token -ne 'fixture-refresh' -or ($script:delays -join ',') -ne '12,12,17') { throw 'poll behavior mismatch' }
    function Invoke-RestMethod { throw 'fixture-sensitive-response' }
    try { Request-OutlookToken @{}; throw 'expected failure' } catch {
      if ($_.Exception.Message -notlike 'Microsoft sign-in failed.*') { throw 'unsafe error' }
    }
    Write-Output 'polling verified'
  `], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /polling verified/);
  assert.doesNotMatch(result.stdout + result.stderr, /fixture-sensitive-response/);
});

test('Outlook setup encrypts refresh tokens and launcher rotates them before passing only access token to Node', { skip: process.platform !== 'win32' }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bmail-outlook-'));
  const engine = path.join(root, 'engine');
  const data = path.join(root, 'data');
  fs.mkdirSync(engine); fs.mkdirSync(data);
  const env = { ...process.env, MAIL_VAULT_DATA_DIR: data };
  const run = (script, input) => spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { env, input, encoding: 'utf8', windowsHide: true, timeout: 30000 });
  try {
    for (const file of ['Save-Mailbox.ps1', 'Outlook-Auth.ps1', 'Protect-CredentialDirectory.ps1', 'Data-Directory.ps1', 'Run-Backup.ps1', 'Backup-Paths.ps1', 'Invoke-BackupProcess.ps1']) fs.copyFileSync(path.resolve('engine', file), path.join(engine, file));
    const saved = run(`
      function Start-Sleep {}
      function Invoke-RestMethod { return @{ access_token = 'fixture-access'; refresh_token = 'fixture-refresh' } }
      & ${psQuote(path.join(engine, 'Save-Mailbox.ps1'))}
    `, JSON.stringify({ user: 'fixture@outlook.com', host: 'outlook.office365.com', port: 993, password: '', client_id: '11111111-1111-1111-1111-111111111111', device_code: 'fixture-device', device_interval: 5 }));
    assert.equal(saved.status, 0, saved.stderr || saved.stdout);
    assert.equal(JSON.parse(fs.readFileSync(path.join(data, 'backup-config.json'), 'utf8').replace(/^\uFEFF/, '')).authType, 'oauth2');
    assert.doesNotMatch(fs.readFileSync(path.join(data, '.private/zoho-credential.xml'), 'utf8'), /fixture-refresh|fixture-access/);
    fs.writeFileSync(path.join(engine, 'backup.cjs'), `
      (async () => {
        let input = ''; for await (const chunk of process.stdin) input += chunk;
        const auth = JSON.parse(input.replace(/^\\uFEFF/, ''));
        if (auth.user !== 'fixture@outlook.com' || auth.accessToken !== 'fixture-new-access' || auth.password || input.includes('refresh')) process.exit(9);
        console.log('OAuth launcher verified');
      })();
    `);
    const launched = run(`
      function Invoke-RestMethod {
        param($Uri, $Method, $Body, $TimeoutSec)
        if ($Body.grant_type -ne 'refresh_token' -or $Body.refresh_token -ne 'fixture-refresh') { throw 'wrong refresh request' }
        return @{ access_token = 'fixture-new-access'; refresh_token = 'fixture-rotated' }
      }
      & ${psQuote(path.join(engine, 'Run-Backup.ps1'))} -Mode Stats
    `);
    assert.equal(launched.status, 0, launched.stderr || launched.stdout);
    assert.match(launched.stdout, /OAuth launcher verified/);
    const rotated = run(`$c = Import-Clixml -LiteralPath ${psQuote(path.join(data, '.private/zoho-credential.xml'))}; if (($c.GetNetworkCredential().Password | ConvertFrom-Json).refreshToken -ne 'fixture-rotated') { exit 4 }`);
    assert.equal(rotated.status, 0, rotated.stderr);
    assert.doesNotMatch(saved.stdout + launched.stdout + launched.stderr, /fixture-(access|refresh|new-access|rotated)/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('Outlook email domains select Microsoft sign-in while custom IMAP hosts stay custom', async () => {
  const { outlookHost, outlookAddressHost, providerForHost } = await import('../src/mail-providers.js');
  for (const host of ['outlook.in', 'OUTLOOK.COM', ' hotmail.com ', 'live.in', 'hotmail.co.uk']) {
    assert.equal(outlookHost(host), true);
    assert.equal(outlookAddressHost(host), true);
    assert.equal(providerForHost(host), 'outlook');
  }
  assert.equal(providerForHost('outlook.office365.com'), 'outlook');
  assert.equal(outlookAddressHost('outlook.office365.com'), false);
  for (const host of ['imap.example.com', 'outlook.com.example.com', 'notoutlook.in', undefined]) assert.equal(outlookHost(host), false);
});

test('wrong Outlook server fails immediately with recovery instructions instead of a network timeout', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bmail-outlook-host-'));
  try {
    fs.writeFileSync(path.join(root, 'backup-config.json'), JSON.stringify({ user: 'fixture@outlook.in', host: 'outlook.in', port: 993, backupDirectory: 'backups' }));
    const result = spawnSync(process.execPath, [path.resolve('engine/backup.cjs'), '--new-mail'], { env: { ...process.env, MAIL_VAULT_DATA_DIR: root }, input: '{}', encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Open Account settings/);
    assert.match(result.stderr, /outlook.office365.com/);
    assert.doesNotMatch(result.stderr, /ETIMEDOUT/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('saved wrong Outlook host can be corrected only for the same mailbox without an existing manifest', { skip: process.platform !== 'win32' }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bmail-outlook-repair-'));
  const configPath = path.join(root, 'backup-config.json');
  const initial = { user: 'fixture@outlook.in', host: 'outlook.in', port: 993, backupDirectory: 'custom-backups', backupOptions: { folders: ['INBOX'], advanced: { retryAttempts: 2, excludedFolders: ['Spam'] } } };
  const request = { user: initial.user, host: 'outlook.office365.com', port: 993, password: '', client_id: '11111111-1111-1111-1111-111111111111', device_code: 'fixture-device', device_interval: 5 };
  const run = settings => spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `
    function Start-Sleep {}
    function Invoke-RestMethod { return @{ access_token = 'fixture-access'; refresh_token = 'fixture-refresh' } }
    & ${psQuote(path.resolve('engine/Save-Mailbox.ps1'))}
  `], { input: JSON.stringify(settings), env: { ...process.env, MAIL_VAULT_DATA_DIR: root }, encoding: 'utf8', timeout: 15000, windowsHide: true });
  try {
    fs.writeFileSync(configPath, JSON.stringify(initial));
    const rejected = run({ ...request, host: 'outlook.in', client_id: '', device_code: '', password: 'fixture-app-password' });
    assert.equal(rejected.status, 1);
    assert.equal(JSON.parse(rejected.stdout).errorCode, 'OUTLOOK_SIGN_IN_REQUIRED');
    assert.deepEqual(JSON.parse(fs.readFileSync(configPath)), initial);
    assert.equal(fs.existsSync(path.join(root, '.private/zoho-credential.xml')), false);
    const mismatch = run({ ...request, user: 'different@outlook.in' });
    assert.equal(mismatch.status, 1);
    assert.equal(JSON.parse(mismatch.stdout).errorCode, 'MAILBOX_IDENTITY_MISMATCH');
    fs.mkdirSync(path.join(root, initial.backupDirectory));
    fs.writeFileSync(path.join(root, initial.backupDirectory, 'manifest.json'), 'unreadable existing manifest');
    const protectedResult = run(request);
    assert.equal(protectedResult.status, 1);
    assert.equal(JSON.parse(protectedResult.stdout).errorCode, 'MAILBOX_IDENTITY_MISMATCH');
    assert.deepEqual(JSON.parse(fs.readFileSync(configPath)), initial);
    fs.unlinkSync(path.join(root, initial.backupDirectory, 'manifest.json'));
    const repaired = run(request);
    assert.equal(repaired.status, 0, repaired.stderr || repaired.stdout);
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, ''));
    assert.equal(config.host, 'outlook.office365.com');
    assert.equal(config.authType, 'oauth2');
    assert.equal(config.user, initial.user);
    assert.equal(config.backupDirectory, initial.backupDirectory);
    assert.deepEqual(config.backupOptions, initial.backupOptions);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
