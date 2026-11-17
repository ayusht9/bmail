param([switch]$ValidateOnly)
# Optional desktop alert for both manual and scheduled runs. No installation,
# elevation, Windows password or permanent tray application is required.
$ErrorActionPreference = 'Stop'
try {
    $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    if ($ValidateOnly) { Write-Output 'Notification payload and Windows desktop API available'; exit 0 }
    $icon = New-Object System.Windows.Forms.NotifyIcon
    $icon.Icon = [Drawing.SystemIcons]::Information
    $icon.Text = 'Bmail backup'
    $icon.Visible = $true
    $tip = if ($request.failed) { [Windows.Forms.ToolTipIcon]::Warning } else { [Windows.Forms.ToolTipIcon]::Info }
    $icon.ShowBalloonTip(5000, ([string]$request.title).Substring(0, [Math]::Min(63, ([string]$request.title).Length)), ([string]$request.message).Substring(0, [Math]::Min(400, ([string]$request.message).Length)), $tip)
    $timer = New-Object Windows.Forms.Timer
    $timer.Interval = 6000
    $timer.Add_Tick({ $timer.Stop(); [Windows.Forms.Application]::ExitThread() })
    $timer.Start()
    [Windows.Forms.Application]::Run()
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
} finally {
    if ($timer) { $timer.Dispose() }
    if ($icon) { $icon.Visible = $false; $icon.Dispose() }
}
