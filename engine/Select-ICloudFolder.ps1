$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Windows.Forms
$picker = New-Object System.Windows.Forms.FolderBrowserDialog
try {
    $picker.Description = 'Choose your iCloud Drive folder. iCloud for Windows handles cloud uploads.'
    $picker.ShowNewFolderButton = $false
    foreach ($candidate in @((Join-Path $env:USERPROFILE 'iCloudDrive'), (Join-Path $env:USERPROFILE 'iCloud Drive'))) {
        if (Test-Path -LiteralPath $candidate -PathType Container) { $picker.SelectedPath = $candidate; break }
    }
    $selected = if ($picker.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { $picker.SelectedPath } else { $null }
    @{ folder = $selected } | ConvertTo-Json -Compress
} finally { $picker.Dispose() }
