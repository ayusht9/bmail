$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Backup-Paths.ps1')
. (Join-Path $PSScriptRoot 'Backup-Schedule.ps1')
$config = Get-Content -LiteralPath (Join-Path $dataDirectory 'backup-config.json') -Raw | ConvertFrom-Json
$path = Join-Path $dataDirectory 'backup-schedule.json'
$settings = if (Test-Path -LiteralPath $path) { Get-Content -LiteralPath $path -Raw | ConvertFrom-Json } else { [pscustomobject](Get-BmailScheduleDefaults) }
$scheduleLock = Enter-BmailScheduleLock $dataDirectory
try { Save-BmailSchedule $dataDirectory $PSScriptRoot $config.user $settings | ConvertTo-Json -Depth 8 }
finally { $scheduleLock.Dispose() }
