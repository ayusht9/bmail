param([ValidateSet('Backup', 'Folders', 'Stats', 'NewMail', 'Watch')][string]$Mode = 'Backup', [switch]$Scheduled)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Invoke-BackupProcess.ps1')
. (Join-Path $PSScriptRoot 'Backup-Paths.ps1')
try {
    if ($Scheduled -and $Mode -ne 'Backup') { throw 'Scheduled mode is only available for backups.' }
    if ($Scheduled) {
        $parent = Split-Path -Parent $dataDirectory
        $base = if ((Split-Path -Leaf $parent) -ieq 'accounts') { Split-Path -Parent $parent } else { $dataDirectory }
        $settingsPath = Join-Path $base 'desktop-settings.json'
        if (Test-Path -LiteralPath $settingsPath) {
            $settings = Get-Content -LiteralPath $settingsPath -Raw | ConvertFrom-Json
            if ($settings.scheduledBackupsEnabled -eq $false) { Write-Output 'Scheduled backups are disabled globally.'; exit 0 }
        }
    }
    $credential = Import-Clixml -LiteralPath (Join-Path $dataDirectory '.private\zoho-credential.xml')
    $config = Get-Content -LiteralPath (Join-Path $dataDirectory 'backup-config.json') -Raw | ConvertFrom-Json
    if ($config.authType -eq 'oauth2') {
        . (Join-Path $PSScriptRoot 'Outlook-Auth.ps1')
        $saved = $credential.GetNetworkCredential().Password | ConvertFrom-Json
        $tokens = Request-OutlookToken @{ client_id = $saved.clientId; grant_type = 'refresh_token'; refresh_token = $saved.refreshToken; scope = $outlookScope }
        if (!$tokens.access_token) { throw 'Microsoft sign-in expired. Sign in again in mailbox settings.' }
        if ($tokens.refresh_token) {
            $saved.refreshToken = $tokens.refresh_token
            $secret = ConvertTo-SecureString ($saved | ConvertTo-Json -Compress) -AsPlainText -Force
            $updated = New-Object System.Management.Automation.PSCredential($credential.UserName, $secret)
            $credentialPath = Join-Path $dataDirectory '.private\zoho-credential.xml'
            $updated | Export-Clixml -LiteralPath ($credentialPath + '.pending')
            Move-Item -LiteralPath ($credentialPath + '.pending') -Destination $credentialPath -Force
        }
        $payload = @{ user = $credential.UserName; accessToken = $tokens.access_token } | ConvertTo-Json -Compress
    } else {
        $payload = @{ user = $credential.UserName; password = $credential.GetNetworkCredential().Password } | ConvertTo-Json -Compress
    }
    $logDirectory = Join-Path $dataDirectory 'logs'
    New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
    $logPath = Join-Path $logDirectory ((Get-Date -Format 'yyyy-MM-dd_HH-mm-ss') + '.log')
    if ($Mode -eq 'Watch') { $env:BMAIL_WATCH_PARENT = [string]$PID }
    $engineArgument = if ($Mode -eq 'Watch') { '--watch-new-mail' } elseif ($Mode -eq 'Folders') { '--list-folders' } elseif ($Mode -eq 'NewMail') { '--new-mail' } elseif ($Mode -eq 'Stats') { '--check-mailbox' } elseif ($Scheduled) { '--scheduled' } else { '' }
    $result = Invoke-BackupProcess -NodePath $nodePath -ScriptPath (Join-Path $PSScriptRoot 'backup.cjs') -Payload $payload -LogPath $logPath -EngineArgument $engineArgument
    $payload = $null
    $credential = $null
    exit $result
} catch {
    Write-Host ('Backup launcher failed: ' + $_.Exception.Message)
    Write-Host 'Completed downloads are retained. Check logs and backups\last-run.json before retrying.'
    exit 1
}
