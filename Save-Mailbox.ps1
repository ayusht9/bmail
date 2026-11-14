$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
. (Join-Path $PSScriptRoot 'Backup-Paths.ps1')
. (Join-Path $PSScriptRoot 'Protect-CredentialDirectory.ps1')

try {
    # Read secrets only from stdin, never from process arguments or log files.
    $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
    # Google's app-password screen groups characters with spaces for readability.
    if ($request.host -ieq 'imap.gmail.com') { $request.password = $request.password -replace '\s', '' }
    if ($request.user -notmatch '^[^\s@]+@[^\s@]+$') { throw 'Enter a valid email address.' }
    if ($request.host -notmatch '^[a-zA-Z0-9.-]+$') { throw 'Enter an IMAP server hostname.' }
    if ([int]$request.port -lt 1 -or [int]$request.port -gt 65535) { throw 'Enter a valid IMAP port.' }
    if ([string]::IsNullOrWhiteSpace($request.password)) { throw 'Enter your application-specific password.' }
    New-Item -ItemType Directory -Path $dataDirectory -Force | Out-Null
    $configPath = Join-Path $dataDirectory 'backup-config.json'
    $existing = if (Test-Path -LiteralPath $configPath) {
        Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
    } else { $null }
    if ($existing -and ($existing.user -cne $request.user -or $existing.host -cne $request.host -or [int]$existing.port -ne [int]$request.port)) {
        throw 'This profile already has a mailbox. Keep its email, server and port to update the password.'
    }
    $privateDirectory = Join-Path $dataDirectory '.private'
    New-Item -ItemType Directory -Path $privateDirectory -Force | Out-Null
    Protect-CredentialDirectory -LiteralPath $privateDirectory
    $password = ConvertTo-SecureString -String $request.password -AsPlainText -Force
    $credential = New-Object System.Management.Automation.PSCredential($request.user, $password)
    $temporaryCredential = Join-Path $privateDirectory 'zoho-credential.xml.pending'
    $credential | Export-Clixml -LiteralPath $temporaryCredential
    Move-Item -LiteralPath $temporaryCredential -Destination (Join-Path $privateDirectory 'zoho-credential.xml') -Force
    if (-not $existing) {
        $config = @{ user = $request.user; host = $request.host; port = [int]$request.port; backupDirectory = 'backups' }
        $config | ConvertTo-Json | Set-Content -LiteralPath ($configPath + '.pending') -Encoding UTF8
        Move-Item -LiteralPath ($configPath + '.pending') -Destination $configPath -Force
    }
    $request = $null
    $password = $null
    $credential = $null
    Write-Output 'Mailbox saved. You can start your first backup.'
} catch {
    # Do not echo request data, raw parsing errors, or credentials.
    [Console]::Error.WriteLine('Mailbox setup failed. Check your email, server and port. Existing profiles must keep the same mailbox settings.')
    exit 1
}
