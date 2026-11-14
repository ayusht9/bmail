# Installed app scripts are immutable; configuration and mail belong to the user.
$dataDirectory = if ($env:MAIL_VAULT_DATA_DIR) { $env:MAIL_VAULT_DATA_DIR } else { $PSScriptRoot }
$nodePath = if (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'node.exe')) {
    Join-Path $PSScriptRoot 'node.exe'
} else { (Get-Command node -ErrorAction Stop).Source }
