$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Invoke-BackupProcess.ps1')
try {
    $nodePath = (Get-Command node -ErrorAction Stop).Source
    $credential = Import-Clixml -LiteralPath (Join-Path $PSScriptRoot '.private\zoho-credential.xml')
    $payload = @{ user = $credential.UserName; password = $credential.GetNetworkCredential().Password } | ConvertTo-Json -Compress
    $logDirectory = Join-Path $PSScriptRoot 'logs'
    New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
    $logPath = Join-Path $logDirectory ((Get-Date -Format 'yyyy-MM-dd_HH-mm-ss') + '.log')
    $result = Invoke-BackupProcess -NodePath $nodePath -ScriptPath (Join-Path $PSScriptRoot 'backup.cjs') -Payload $payload -LogPath $logPath
    $payload = $null
    $credential = $null
    exit $result
} catch {
    Write-Host ('Backup launcher failed: ' + $_.Exception.Message)
    Write-Host 'Completed downloads are retained. Check logs and backups\last-run.json before retrying.'
    exit 1
}
