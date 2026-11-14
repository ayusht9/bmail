param([ValidateSet('Backup', 'Folders')][string]$Mode = 'Backup')
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Invoke-BackupProcess.ps1')
. (Join-Path $PSScriptRoot 'Backup-Paths.ps1')
try {
    $credential = Import-Clixml -LiteralPath (Join-Path $dataDirectory '.private\zoho-credential.xml')
    $payload = @{ user = $credential.UserName; password = $credential.GetNetworkCredential().Password } | ConvertTo-Json -Compress
    $logDirectory = Join-Path $dataDirectory 'logs'
    New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
    $logPath = Join-Path $logDirectory ((Get-Date -Format 'yyyy-MM-dd_HH-mm-ss') + '.log')
    $engineArgument = if ($Mode -eq 'Folders') { '--list-folders' } else { '' }
    $result = Invoke-BackupProcess -NodePath $nodePath -ScriptPath (Join-Path $PSScriptRoot 'backup.cjs') -Payload $payload -LogPath $logPath -EngineArgument $engineArgument
    $payload = $null
    $credential = $null
    exit $result
} catch {
    Write-Host ('Backup launcher failed: ' + $_.Exception.Message)
    Write-Host 'Completed downloads are retained. Check logs and backups\last-run.json before retrying.'
    exit 1
}
