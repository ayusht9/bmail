param([string]$ClientId)
$ErrorActionPreference = 'Stop'
try {
    . (Join-Path $PSScriptRoot 'Outlook-Auth.ps1')
    if ($ClientId -notmatch '^[0-9a-fA-F-]{36}$') { throw 'Invalid client ID' }
    $response = Invoke-RestMethod -Uri "$outlookAuthority/devicecode" -Method Post -Body @{ client_id = $ClientId; scope = $outlookScope } -TimeoutSec 30
    $response | Select-Object device_code, user_code, verification_uri, expires_in, interval | ConvertTo-Json -Compress
} catch { exit 1 }
