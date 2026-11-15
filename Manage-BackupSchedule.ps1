$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Backup-Paths.ps1')
. (Join-Path $PSScriptRoot 'Backup-Schedule.ps1')
try {
    $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
    $config = Get-Content -LiteralPath (Join-Path $dataDirectory 'backup-config.json') -Raw | ConvertFrom-Json
    if (-not $config.user) { throw 'Set up your mailbox first.' }
    $scheduleLock = Enter-BmailScheduleLock $dataDirectory
    $result = switch ($request.action) {
        'read' { Get-BmailScheduleStatus $dataDirectory $config.user }
        'save' { Save-BmailSchedule $dataDirectory $PSScriptRoot $config.user $request.schedule }
        'remove' {
            foreach ($name in @(Get-BmailAccountTaskNames $config.user)) {
                $task = Find-BmailTask $name
                if ($task) { $task | Unregister-ScheduledTask -Confirm:$false -ErrorAction Stop }
            }
            # Keep the user's settings for later reinstallation; mark them paused.
            $path = Join-Path $dataDirectory 'backup-schedule.json'
            if (Test-Path -LiteralPath $path) {
                $saved = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
                $saved.enabled = $false
                $saved | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $path -Encoding UTF8
            }
            Get-BmailScheduleStatus $dataDirectory $config.user
        }
        default { throw 'Unknown schedule action.' }
    }
    $result | ConvertTo-Json -Depth 8 -Compress | Write-Output
} catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }
finally { if ($scheduleLock) { $scheduleLock.Dispose() } }
