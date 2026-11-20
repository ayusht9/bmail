$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Backup-Paths.ps1')
. (Join-Path $PSScriptRoot 'Protect-CredentialDirectory.ps1')
try {
    $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
    $directory = Join-Path $dataDirectory '.private'
    $provider = if ($request.provider) { $request.provider } else { 'google-drive' }
    if ($provider -notin @('google-drive', 'dropbox')) { throw 'Unknown provider' }
    $file = Join-Path $directory ($provider + '.dat')
    switch ($request.action) {
        'import' {
            if ($provider -ne 'google-drive') { throw 'Import is not supported' }
            Add-Type -AssemblyName System.Windows.Forms
            $picker = New-Object System.Windows.Forms.OpenFileDialog
            $picker.Title = 'Choose Google OAuth desktop client JSON'
            $picker.Filter = 'Google OAuth client (*.json)|*.json'
            if ($picker.ShowDialog() -ne 'OK') { [Console]::Out.Write('null'); exit 0 }
            if ((Get-Item -LiteralPath $picker.FileName).Length -gt 65536) { throw 'Invalid client file' }
            $client = Get-Content -LiteralPath $picker.FileName -Raw | ConvertFrom-Json
            if (!$client.installed.client_id -or !$client.installed.client_secret) { throw 'Choose a desktop client file' }
            @{ clientId = $client.installed.client_id; clientSecret = $client.installed.client_secret } | ConvertTo-Json -Compress | Write-Output
        }
        'read' {
            if (!(Test-Path -LiteralPath $file)) { [Console]::Out.Write('null'); exit 0 }
            $secure = (Get-Content -LiteralPath $file -Raw).Trim() | ConvertTo-SecureString
            $credential = New-Object System.Management.Automation.PSCredential('Bmail Google Drive', $secure)
            [Console]::Out.Write($credential.GetNetworkCredential().Password)
        }
        'save' {
            New-Item -ItemType Directory -Path $directory -Force | Out-Null
            Protect-CredentialDirectory -LiteralPath $directory
            $secure = ConvertTo-SecureString ($request.value | ConvertTo-Json -Depth 8 -Compress) -AsPlainText -Force
            $secure | ConvertFrom-SecureString | Set-Content -LiteralPath ($file + '.pending') -Encoding UTF8
            Move-Item -LiteralPath ($file + '.pending') -Destination $file -Force
            [Console]::Out.Write('null')
        }
        'delete' {
            if (Test-Path -LiteralPath $file) { Remove-Item -LiteralPath $file -Force }
            [Console]::Out.Write('null')
        }
        default { throw 'Invalid credential operation' }
    }
} catch {
    # Never print credentials, imported JSON, or exception payloads.
    [Console]::Error.Write('Google Drive credentials could not be read or saved.')
    if ($request.action -eq 'import') { exit 2 }
    exit 1
}
