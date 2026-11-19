$ErrorActionPreference = 'Stop'
$failureCode = 'SETUP_START_FAILED'
try {
    # Read secrets from stdin; Microsoft OAuth needs network access, never Node.
    . (Join-Path $PSScriptRoot 'Data-Directory.ps1')
    . (Join-Path $PSScriptRoot 'Protect-CredentialDirectory.ps1')
    # Read secrets only from stdin, never from process arguments or log files.
    $failureCode = 'INVALID_REQUEST'
    # A GUI-launched PowerShell process has no console whose code page can be set.
    # Decode the stdin pipe directly instead of assigning Console.InputEncoding.
    $reader = [IO.StreamReader]::new([Console]::OpenStandardInput(), [Text.UTF8Encoding]::new($false))
    try { $inputText = $reader.ReadToEnd() } finally { $reader.Dispose() }
    $request = $inputText | ConvertFrom-Json
    $inputText = $null
    # Google's app-password screen groups characters with spaces for readability.
    if ($request.host -ieq 'imap.gmail.com') { $request.password = $request.password -replace '\s', '' }
    if ($request.user -notmatch '^[^\s@]+@[^\s@]+$') { $failureCode = 'INVALID_EMAIL'; throw 'Invalid email' }
    if ($request.host -notmatch '^[a-zA-Z0-9.-]+$') { $failureCode = 'INVALID_HOST'; throw 'Invalid host' }
    if ([int]$request.port -lt 1 -or [int]$request.port -gt 65535) { $failureCode = 'INVALID_PORT'; throw 'Invalid port' }
    if ($request.host -ieq 'imap.gmail.com' -and [int]$request.port -ne 993) { $failureCode = 'GMAIL_REQUIRES_993'; throw 'Invalid Gmail port' }
    $outlookAddressHostPattern = '^(outlook|hotmail|live|msn)\.(com|in|co\.uk)$'
    if ($request.host -imatch $outlookAddressHostPattern) { $request.host = 'outlook.office365.com' }
    $outlook = $request.host -iin @('outlook.office365.com', 'imap-mail.outlook.com')
    if ($outlook -and (!$request.client_id -or !$request.device_code)) { $failureCode = 'OUTLOOK_SIGN_IN_REQUIRED'; throw 'Microsoft sign-in required' }
    if (!$outlook -and [string]::IsNullOrWhiteSpace($request.password)) { $failureCode = 'PASSWORD_REQUIRED'; throw 'Password required' }
    $failureCode = 'DATA_DIRECTORY_UNAVAILABLE'
    New-Item -ItemType Directory -Path $dataDirectory -Force | Out-Null
    $configPath = Join-Path $dataDirectory 'backup-config.json'
    $failureCode = 'CONFIG_UNREADABLE'
    $existing = if (Test-Path -LiteralPath $configPath) {
        Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
    } else { $null }
    $repairHost = $false
    if ($existing -and $existing.user -ceq $request.user -and $existing.host -imatch $outlookAddressHostPattern -and $request.host -ieq 'outlook.office365.com') {
        $backupDirectory = if ($existing.backupDirectory) { $existing.backupDirectory } else { 'backups' }
        # Keep every existing backup identity immutable, including unreadable manifests.
        $repairHost = !(Test-Path -LiteralPath (Join-Path (Join-Path $dataDirectory $backupDirectory) 'manifest.json'))
    }
    if ($existing -and ($existing.user -cne $request.user -or ($existing.host -ine $request.host -and !$repairHost))) {
        $failureCode = 'MAILBOX_IDENTITY_MISMATCH'
        throw 'The saved mailbox identity cannot be changed.'
    }
    if ($outlook) {
        $failureCode = 'OUTLOOK_AUTH_FAILED'
        if ([int]$request.port -ne 993) { throw 'Outlook requires TLS port 993' }
        . (Join-Path $PSScriptRoot 'Outlook-Auth.ps1')
        $tokens = Wait-OutlookToken -ClientId $request.client_id -DeviceCode $request.device_code -Interval $request.device_interval
        $request.password = @{ clientId = $request.client_id; refreshToken = $tokens.refresh_token } | ConvertTo-Json -Compress
    }
    $failureCode = 'CREDENTIAL_DIRECTORY_UNAVAILABLE'
    $privateDirectory = Join-Path $dataDirectory '.private'
    New-Item -ItemType Directory -Path $privateDirectory -Force | Out-Null
    Protect-CredentialDirectory -LiteralPath $privateDirectory
    $failureCode = 'PASSWORD_ENCRYPTION_FAILED'
    $password = ConvertTo-SecureString -String $request.password -AsPlainText -Force
    $credential = New-Object System.Management.Automation.PSCredential($request.user, $password)
    $temporaryCredential = Join-Path $privateDirectory 'zoho-credential.xml.pending'
    $credential | Export-Clixml -LiteralPath $temporaryCredential
    $failureCode = 'CREDENTIAL_SAVE_FAILED'
    Move-Item -LiteralPath $temporaryCredential -Destination (Join-Path $privateDirectory 'zoho-credential.xml') -Force
    $failureCode = 'CONFIG_SAVE_FAILED'
    $config = if ($existing) { $existing } else { @{ user = $request.user; host = $request.host; port = [int]$request.port; backupDirectory = 'backups' } }
    $config.host = $request.host
    $config.port = [int]$request.port
    $config | Add-Member -NotePropertyName authType -NotePropertyValue $(if ($outlook) { "oauth2" } else { "basic" }) -Force
    $config | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath ($configPath + '.pending') -Encoding UTF8
    Move-Item -LiteralPath ($configPath + '.pending') -Destination $configPath -Force
    $request = $null
    $password = $null
    $credential = $null
    Write-Output 'Mailbox saved. You can start your first backup.'
} catch {
    # Do not echo request data, raw parsing errors, or credentials.
    @{ errorCode = $failureCode } | ConvertTo-Json -Compress | Write-Output
    exit 1
}
