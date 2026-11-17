param([switch]$ResetCredential)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Protect-CredentialDirectory.ps1')
. (Join-Path $PSScriptRoot 'Backup-Paths.ps1')
$config = Get-Content -LiteralPath (Join-Path $dataDirectory 'backup-config.json') -Raw | ConvertFrom-Json
Write-Host ('Configuring read-only backups for ' + $config.user)
$privateDirectory = Join-Path $dataDirectory '.private'
New-Item -ItemType Directory -Path $privateDirectory -Force | Out-Null
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
Protect-CredentialDirectory -LiteralPath $privateDirectory
$credentialPath = Join-Path $privateDirectory 'zoho-credential.xml'
if ($ResetCredential -or -not (Test-Path -LiteralPath $credentialPath)) {
    Write-Host 'Enter your Zoho application-specific password locally. It will be encrypted for this Windows user on this computer.'
    $password = Read-Host 'Zoho app password (hidden)' -AsSecureString
    if ($password.Length -eq 0) { throw 'No password entered.' }
    $credential = New-Object System.Management.Automation.PSCredential($config.user, $password)
    $credential | Export-Clixml -LiteralPath $credentialPath
    $password = $null
    $credential = $null
} else {
    Write-Host 'Using your saved encrypted credential.'
}
Write-Host 'Starting/resuming the backup. Completed downloads will be verified and reused.'
$powershellPath = Join-Path $PSHOME 'powershell.exe'
& $powershellPath -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'Run-Backup.ps1')
if ($LASTEXITCODE -ne 0) { throw 'Backup did not complete. No schedule was installed. See logs and backups\last-run.json for the error; completed downloads are retained.' }
. (Join-Path $PSScriptRoot 'Install-BackupSchedule.ps1')
Write-Host 'Ready: weekly on Monday at 11:00 Windows local time, while you are signed in and the computer is on.'
Write-Host ('Local emails: ' + (Join-Path $dataDirectory $config.backupDirectory))
Write-Host 'This backup never deletes server email and therefore does not automatically free Zoho storage.'
