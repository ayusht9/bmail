function Invoke-BackupProcess {
    param(
        [Parameter(Mandatory = $true)][string]$NodePath,
        [Parameter(Mandatory = $true)][string]$ScriptPath,
        [Parameter(Mandatory = $true)][string]$Payload,
        [Parameter(Mandatory = $true)][string]$LogPath,
        [ValidateSet('', '--list-folders')][string]$EngineArgument = ''
    )
    $start = New-Object Diagnostics.ProcessStartInfo
    $start.FileName = $NodePath
    $start.Arguments = '"' + $ScriptPath + '"'
    if ($EngineArgument) { $start.Arguments += ' ' + $EngineArgument }
    $start.WorkingDirectory = Split-Path -Parent $ScriptPath
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardInput = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    $process = New-Object Diagnostics.Process
    $process.StartInfo = $start
    try {
        [void]$process.Start()
        # Drain stderr concurrently so it cannot block stdout or become a
        # terminating NativeCommandError in Windows PowerShell 5.1.
        $errorOutput = $process.StandardError.ReadToEndAsync()
        $process.StandardInput.WriteLine($Payload)
        $process.StandardInput.Close()
        while ($null -ne ($line = $process.StandardOutput.ReadLine())) {
            Write-Host $line
            Add-Content -LiteralPath $LogPath -Value $line -Encoding UTF8
        }
        $process.WaitForExit()
        $errorText = $errorOutput.GetAwaiter().GetResult()
        if ($errorText) {
            Write-Host $errorText
            Add-Content -LiteralPath $LogPath -Value $errorText -Encoding UTF8
        }
        return $process.ExitCode
    } finally { $process.Dispose() }
}
