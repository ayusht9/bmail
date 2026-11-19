$outlookScope = 'https://outlook.office.com/IMAP.AccessAsUser.All offline_access'
$outlookAuthority = 'https://login.microsoftonline.com/common/oauth2/v2.0'

function Request-OutlookToken($Body) {
    try {
        Invoke-RestMethod -Uri "$outlookAuthority/token" -Method Post -Body $Body -TimeoutSec 30
    } catch {
        # Never expose Microsoft's raw response, which can contain sensitive data.
        $code = 'connection_failed'
        try { $code = ($_.ErrorDetails.Message | ConvertFrom-Json).error } catch {}
        if ($code -in @('authorization_pending', 'slow_down')) { return @{ error = $code } }
        throw 'Microsoft sign-in failed. Sign in again and check your app registration and IMAP access.'
    }
}

function Wait-OutlookToken([string]$ClientId, [string]$DeviceCode, [int]$Interval = 10) {
    if ($ClientId -notmatch '^[0-9a-fA-F-]{36}$' -or !$DeviceCode) { throw 'Start Microsoft sign-in first.' }
    $deadline = (Get-Date).AddMinutes(15)
    # Microsoft normally requests five seconds; use a conservative initial interval.
    $interval = [Math]::Max(5, $Interval)
    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Seconds $interval
        $tokens = Request-OutlookToken @{ client_id = $ClientId; device_code = $DeviceCode; grant_type = 'urn:ietf:params:oauth:grant-type:device_code' }
        if ($tokens.access_token -and $tokens.refresh_token) { return $tokens }
        if ($tokens.error -eq 'slow_down') { $interval += 5 }
        elseif ($tokens.error -ne 'authorization_pending') { throw 'Microsoft did not return offline access. Start sign-in again.' }
    }
    throw 'Microsoft sign-in expired. Start sign-in again.'
}
