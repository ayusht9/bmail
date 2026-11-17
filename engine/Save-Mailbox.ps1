$ErrorActionPreference = 'Stop'
$failureCode = 'SETUP_START_FAILED'
try {
    # Saving a password does not need Node or an IMAP connection.
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
    if ([string]::IsNullOrWhiteSpace($request.password)) { $failureCode = 'PASSWORD_REQUIRED'; throw 'Password required' }
    $failureCode = 'DATA_DIRECTORY_UNAVAILABLE'
    New-Item -ItemType Directory -Path $dataDirectory -Force | Out-Null
    $configPath = Join-Path $dataDirectory 'backup-config.json'
    $failureCode = 'CONFIG_UNREADABLE'
    $existing = if (Test-Path -LiteralPath $configPath) {
        Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
    } else { $null }
    if ($existing -and ($existing.user -cne $request.user -or $existing.host -ine $request.host)) {
        $failureCode = 'MAILBOX_IDENTITY_MISMATCH'
        throw 'This profile already has a mailbox. Keep its email, server and port to update the password.'
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
    $config.port = [int]$request.port
    $config | ConvertTo-Json | Set-Content -LiteralPath ($configPath + '.pending') -Encoding UTF8
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
