# Match paths.cjs: source checkouts retain data at the repository root.
$sourceRoot = Split-Path -Parent $PSScriptRoot
$dataDirectory = if ($env:MAIL_VAULT_DATA_DIR) {
    $env:MAIL_VAULT_DATA_DIR
} elseif (Test-Path -LiteralPath (Join-Path $sourceRoot 'package.json')) {
    $sourceRoot
} else { $PSScriptRoot }
