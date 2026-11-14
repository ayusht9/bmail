$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Backup-Paths.ps1')
$config = Get-Content -LiteralPath (Join-Path $dataDirectory 'backup-config.json') -Raw | ConvertFrom-Json
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$powershellPath = Join-Path $PSHOME 'powershell.exe'
# A fixed wrapper restores the data path when Task Scheduler starts a new process.
$launcher = Join-Path $dataDirectory 'Scheduled-Backup.ps1'
$escapedData = $dataDirectory.Replace("'", "''")
$escapedScript = (Join-Path $PSScriptRoot 'Run-Backup.ps1').Replace("'", "''")
@"
`$env:MAIL_VAULT_DATA_DIR = '$escapedData'
& '$escapedScript'
exit `$LASTEXITCODE
"@ | Set-Content -LiteralPath $launcher -Encoding UTF8
$arguments = '-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $launcher + '"'
$action = New-ScheduledTaskAction -Execute $powershellPath -Argument $arguments -WorkingDirectory $PSScriptRoot
$weekly = New-ScheduledTaskTrigger -Weekly -WeeksInterval 1 -DaysOfWeek Monday -At '11:00'
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Days 2)
$principal = New-ScheduledTaskPrincipal -UserId $identity.Name -LogonType Interactive -RunLevel Limited
$taskName = 'Mail Vault Backup - ' + $identity.User.Value + ' - ' + $config.user
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $weekly -Settings $settings -Principal $principal -Description 'Weekly read-only incremental email backup, retaining local copies after server deletion.' -Force | Out-Null
# Retire only this user's exact legacy task after its replacement is registered.
$legacyName = 'Zoho Mail Backup - ' + $identity.User.Value + ' - ' + $config.user
Get-ScheduledTask | Where-Object { $_.TaskName -eq $legacyName -and $_.TaskPath -eq '\' } | Unregister-ScheduledTask -Confirm:$false
Write-Host 'Scheduled weekly on Monday at 11:00 Windows local time, while signed in and the computer is on.'
