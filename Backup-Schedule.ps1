# Shared scheduling functions. Dot-sourcing this file does not register tasks.
function Get-BmailScheduleDefaults {
    return [ordered]@{ enabled = $true; frequency = 'weekly'; startDate = [DateTime]::Today.ToString('yyyy-MM-dd'); time = '11:00';
        weekdays = @(1); monthDay = '1'; intervalHours = 6; every = 1; endDate = $null;
        startWhenAvailable = $true; networkRequired = $true; wakeComputer = $false; allowOnBattery = $true;
        stopOnBattery = $false; maxRunHours = 48; restartCount = 0; restartMinutes = 15; allFolders = $true; folders = @() }
}

function ConvertTo-BmailSchedule {
    param($InputSchedule)
    $value = Get-BmailScheduleDefaults
    if ($null -eq $InputSchedule) { throw 'Schedule settings are required.' }
    foreach ($property in $InputSchedule.PSObject.Properties) {
        if (-not $value.Contains($property.Name)) { throw ('Unknown schedule setting: ' + $property.Name) }
        $value[$property.Name] = $property.Value
    }
    if ($value.frequency -notin @('once', 'daily', 'weekly', 'monthly', 'interval')) { throw 'Choose a valid recurrence.' }
    foreach ($name in @('enabled','startWhenAvailable','networkRequired','wakeComputer','allowOnBattery','stopOnBattery','allFolders')) {
        if ($value[$name] -isnot [bool]) { throw ('Choose a valid value for ' + $name) }
    }
    if ($value.folders -isnot [array] -or $value.folders.Count -gt 1000 -or @($value.folders | Where-Object { $_ -isnot [string] -or [string]::IsNullOrWhiteSpace($_) -or $_.Length -gt 1024 }).Count) { throw 'Choose valid scheduled folders.' }
    $value.folders = @($value.folders | Select-Object -Unique)
    if ($value.allFolders) { $value.folders = @() }
    elseif (-not $value.folders.Count) { throw 'Choose at least one scheduled folder.' }
    foreach ($range in @(@('every',1,365), @('intervalHours',1,24), @('maxRunHours',1,168), @('restartCount',0,10), @('restartMinutes',1,1440))) {
        $number = $value[$range[0]]
        if (($number -isnot [int] -and $number -isnot [long]) -or $number -lt $range[1] -or $number -gt $range[2]) { throw ('Invalid ' + $range[0]) }
    }
    $parsed = [DateTime]::MinValue
    foreach ($name in @('startDate','endDate')) {
        if ($name -eq 'endDate' -and [string]::IsNullOrEmpty($value[$name])) { $value[$name] = $null; continue }
        if (-not [DateTime]::TryParseExact([string]$value[$name], 'yyyy-MM-dd', [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::None, [ref]$parsed)) { throw ('Choose a valid ' + $name) }
    }
    if ($value.endDate -and $value.endDate -lt $value.startDate) { throw 'The end date must not be before the start date.' }
    if ($value.time -notmatch '^([01][0-9]|2[0-3]):[0-5][0-9]$') { throw 'Choose a time in HH:mm format.' }
    if ([string]$value.monthDay -notmatch '^(last|[1-9]|[12][0-9]|3[01])$') { throw 'Choose a day from 1 to 31, or last.' }
    if ($value.frequency -eq 'weekly' -and $value.every -gt 52) { throw 'Choose a weekly interval from 1 to 52.' }
    if ([int]$value.startDate.Substring(0,4) -lt 1970) { throw 'Choose a start date from 1970 onwards.' }
    $value.monthDay = [string]$value.monthDay
    $days = @($value.weekdays)
    if ($days.Count -gt 7 -or @($days | Where-Object { ($_ -isnot [int] -and $_ -isnot [long]) -or $_ -lt 0 -or $_ -gt 6 }).Count) { throw 'Choose valid weekdays.' }
    $value.weekdays = @($days | Sort-Object -Unique)
    if ($value.frequency -eq 'weekly' -and -not $value.weekdays.Count) { throw 'Choose at least one weekday.' }
    $start = [DateTime]::ParseExact(($value.startDate + ' ' + $value.time), 'yyyy-MM-dd HH:mm', [Globalization.CultureInfo]::InvariantCulture)
    if ($value.enabled -and $value.frequency -eq 'once' -and $start -le [DateTime]::Now) { throw 'Choose a future time for a one-time backup.' }
    if ($value.enabled -and $value.endDate -and [DateTime]::ParseExact($value.endDate, 'yyyy-MM-dd', [Globalization.CultureInfo]::InvariantCulture).AddDays(1) -le [DateTime]::Now) { throw 'The schedule end date has already passed.' }
    return [pscustomobject]$value
}

function New-BmailTaskXml {
    param($Schedule, [string]$UserSid, [string]$PowerShellPath, [string]$Launcher, [string]$EngineDirectory)
    $s = $Schedule
    $escape = { param([string]$text) [Security.SecurityElement]::Escape($text) }
    $enabled = $s.enabled.ToString().ToLowerInvariant()
    $end = if ($s.endDate) { '<EndBoundary>' + $s.endDate + 'T23:59:59</EndBoundary>' } else { '' }
    $pattern = switch ($s.frequency) {
        'daily' { '<ScheduleByDay><DaysInterval>' + $s.every + '</DaysInterval></ScheduleByDay>' }
        'weekly' {
            $names = @('Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday')
            '<ScheduleByWeek><WeeksInterval>' + $s.every + '</WeeksInterval><DaysOfWeek>' + (($s.weekdays | ForEach-Object { '<' + $names[$_] + '/>' }) -join '') + '</DaysOfWeek></ScheduleByWeek>'
        }
        'monthly' { '<ScheduleByMonth><DaysOfMonth><Day>' + $(if ($s.monthDay -eq 'last') { 'Last' } else { $s.monthDay }) + '</Day></DaysOfMonth><Months><January/><February/><March/><April/><May/><June/><July/><August/><September/><October/><November/><December/></Months></ScheduleByMonth>' }
        default { '' }
    }
    $trigger = if ($s.frequency -in @('once','interval')) { 'TimeTrigger' } else { 'CalendarTrigger' }
    $repeat = if ($s.frequency -eq 'interval') { '<Repetition><Interval>PT' + $s.intervalHours + 'H</Interval><StopAtDurationEnd>false</StopAtDurationEnd></Repetition>' } else { '' }
    $restart = if ($s.restartCount -gt 0) { '<RestartOnFailure><Interval>PT' + $s.restartMinutes + 'M</Interval><Count>' + $s.restartCount + '</Count></RestartOnFailure>' } else { '' }
    $battery = (-not $s.allowOnBattery).ToString().ToLowerInvariant()
    $stopBattery = $s.stopOnBattery.ToString().ToLowerInvariant()
    $network = $s.networkRequired.ToString().ToLowerInvariant()
    $wake = $s.wakeComputer.ToString().ToLowerInvariant()
    $catchup = $s.startWhenAvailable.ToString().ToLowerInvariant()
    $arguments = '-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $Launcher + '"'
    return @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
<RegistrationInfo><Description>Read-only Bmail backup for the current Windows user.</Description></RegistrationInfo>
<Triggers><$trigger>$repeat<StartBoundary>$($s.startDate)T$($s.time):00</StartBoundary>$end<Enabled>$enabled</Enabled>$pattern</$trigger></Triggers>
<Principals><Principal id="Account"><UserId>$(& $escape $UserSid)</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
<Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><DisallowStartIfOnBatteries>$battery</DisallowStartIfOnBatteries><StopIfGoingOnBatteries>$stopBattery</StopIfGoingOnBatteries><StartWhenAvailable>$catchup</StartWhenAvailable><RunOnlyIfNetworkAvailable>$network</RunOnlyIfNetworkAvailable><WakeToRun>$wake</WakeToRun><Enabled>$enabled</Enabled><ExecutionTimeLimit>PT$($s.maxRunHours)H</ExecutionTimeLimit>$restart</Settings>
<Actions Context="Account"><Exec><Command>$(& $escape $PowerShellPath)</Command><Arguments>$(& $escape $arguments)</Arguments><WorkingDirectory>$(& $escape $EngineDirectory)</WorkingDirectory></Exec></Actions>
</Task>
"@
}

function Get-BmailTaskName {
    param([string]$Email)
    $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    return 'Bmail Backup - ' + $sid + ' - ' + $Email
}

function Find-BmailTask {
    param([string]$Name)
    # TaskName supports wildcards; email addresses must still match literally.
    return Get-ScheduledTask -TaskName $Name -TaskPath '\' -ErrorAction SilentlyContinue | Where-Object { $_.TaskName -eq $Name -and $_.TaskPath -eq '\' }
}

function Get-BmailAccountTaskNames {
    param([string]$Email)
    $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    return @('Bmail Backup - ', 'Mail Vault Backup - ', 'Zoho Mail Backup - ') | ForEach-Object { $_ + $sid + ' - ' + $Email }
}

function Enter-BmailScheduleLock {
    param([string]$DataDirectory)
    return [IO.File]::Open((Join-Path $DataDirectory 'backup-schedule.lock'), [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
}

function Get-BmailScheduleStatus {
    param([string]$DataDirectory, [string]$Email)
    $path = Join-Path $DataDirectory 'backup-schedule.json'
    $settings = if (Test-Path -LiteralPath $path) { Get-Content -LiteralPath $path -Raw | ConvertFrom-Json } else { $null }
    $task = $null
    foreach ($name in @(Get-BmailAccountTaskNames $Email)) { $task = Find-BmailTask $name; if ($task) { break } }
    $info = if ($task) { Get-ScheduledTaskInfo -InputObject $task } else { $null }
    $date = { param($value) if ($value -and $value.Year -gt 2000) { $value.ToString('o') } else { $null } }
    $status = [ordered]@{ settings = $settings; installed = [bool]$task; enabled = [bool]($task -and $task.Settings.Enabled); taskName = $(if ($task) { $task.TaskName } else { $null });
        state = $(if ($task) { [string]$task.State } else { 'Not installed' }); nextRunTime = $(if ($info) { & $date $info.NextRunTime } else { $null });
        lastRunTime = $(if ($info) { & $date $info.LastRunTime } else { $null }); lastResult = $(if ($info) { $info.LastTaskResult } else { $null });
        checkedAt = [DateTime]::Now.ToString('o'); timeZone = [TimeZoneInfo]::Local.Id }
    $status | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $DataDirectory 'backup-schedule-status.json') -Encoding UTF8
    return [pscustomobject]$status
}

function Save-BmailSchedule {
    param([string]$DataDirectory, [string]$EngineDirectory, [string]$Email, $Settings)
    $schedule = ConvertTo-BmailSchedule $Settings
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $launcher = Join-Path $DataDirectory 'Scheduled-Backup.ps1'
    $dataLiteral = $DataDirectory.Replace("'", "''")
    $scriptLiteral = (Join-Path $EngineDirectory 'Run-Backup.ps1').Replace("'", "''")
    $launcherText = "`$env:MAIL_VAULT_DATA_DIR = '$dataLiteral'`r`n& '$scriptLiteral' -Scheduled`r`nexit `$LASTEXITCODE`r`n"
    # Fixed launcher contents do not depend on recurrence settings. Paths are quoted
    # as literals and never include a password or interpolated user expression.
    $launcherText | Set-Content -LiteralPath $launcher -Encoding UTF8
    $xml = New-BmailTaskXml $schedule $identity.User.Value (Join-Path $PSHOME 'powershell.exe') $launcher $EngineDirectory
    $temporary = Join-Path $DataDirectory 'backup-schedule.json.pending'
    $schedule | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $temporary -Encoding UTF8
    try { Register-ScheduledTask -TaskName (Get-BmailTaskName $Email) -TaskPath '\' -Xml $xml -Force -ErrorAction Stop | Out-Null }
    catch { Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue; throw }
    Move-Item -LiteralPath $temporary -Destination (Join-Path $DataDirectory 'backup-schedule.json') -Force
    # Retire only this account's exact legacy tasks after replacement succeeds.
    foreach ($prefix in @('Mail Vault Backup - ', 'Zoho Mail Backup - ')) {
        $legacy = Find-BmailTask ($prefix + $identity.User.Value + ' - ' + $Email)
        if ($legacy) { $legacy | Unregister-ScheduledTask -Confirm:$false }
    }
    return Get-BmailScheduleStatus $DataDirectory $Email
}
