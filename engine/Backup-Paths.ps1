# Installed app scripts are immutable; configuration and mail belong to the user.
. (Join-Path $PSScriptRoot 'Data-Directory.ps1')
$nodePath = if (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'node.exe')) {
    Join-Path $PSScriptRoot 'node.exe'
} else { (Get-Command node -ErrorAction Stop).Source }
