$ErrorActionPreference = 'Stop'
$config = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'backup-config.json') -Raw | ConvertFrom-Json
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$powershellPath = Join-Path $PSHOME 'powershell.exe'
$arguments = '-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + (Join-Path $PSScriptRoot 'Run-Backup.ps1') + '"'
$action = New-ScheduledTaskAction -Execute $powershellPath -Argument $arguments -WorkingDirectory $PSScriptRoot
$weekly = New-ScheduledTaskTrigger -Weekly -WeeksInterval 1 -DaysOfWeek Monday -At '11:00'
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Days 2)
$principal = New-ScheduledTaskPrincipal -UserId $identity.Name -LogonType Interactive -RunLevel Limited
$taskName = 'Zoho Mail Backup - ' + $config.user
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $weekly -Settings $settings -Principal $principal -Description 'Weekly read-only incremental Zoho email backup, retaining local copies after server deletion.' -Force | Out-Null
Write-Host 'Scheduled weekly on Monday at 11:00 Windows local time, while signed in and the computer is on.'
