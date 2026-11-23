# Packages an already-built release. Does not build, sign, install or upload it.
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$IdentityName,
    [Parameter(Mandatory)][string]$IdentityPublisher,
    [Parameter(Mandatory)][string]$PublisherDisplayName,
    [switch]$ValidateOnly
)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
if ($IdentityName -notmatch '^[A-Za-z0-9.-]{3,50}$') { throw 'Copy Package/Identity/Name from Partner Center.' }
if ($IdentityPublisher -notmatch '^CN=') { throw 'Copy the complete Package/Identity/Publisher from Partner Center (starts CN=).' }
if ([string]::IsNullOrWhiteSpace($PublisherDisplayName)) { throw 'Publisher display name is required.' }
$config = Get-Content -LiteralPath (Join-Path $root 'src-tauri/tauri.conf.json') -Raw | ConvertFrom-Json
$cargo = Get-Content -LiteralPath (Join-Path $root 'src-tauri/Cargo.toml') -Raw
if ($cargo -notmatch ('(?m)^version = "' + [regex]::Escape($config.version) + '"')) { throw 'Tauri and Cargo versions differ.' }
if ($config.version -notmatch '^0\.\d+\.\d+$') { throw 'Expected a 0.x.y beta version.' }
$version = "$($config.version).0"
if (@($version.Split('.') | Where-Object { [int]$_ -gt 65535 }).Count) { throw 'MSIX version components must fit UInt16.' }
$sdk = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits/10/bin'
$makeappx = Get-ChildItem -Path "$sdk/*/x64/makeappx.exe" | Sort-Object FullName -Descending | Select-Object -First 1
if (!$makeappx) { throw 'Install the free Windows SDK including MakeAppx.' }
if ($ValidateOnly) {
    Write-Output "Store identity inputs and SDK validated. Package version: $version. No package generated."
    return
}
$release = Join-Path $root 'src-tauri/target/release'
$exe = Join-Path $release 'bmail.exe'
$engine = Join-Path $root 'src-tauri/resources/engine'
foreach ($file in @($exe, (Join-Path $engine 'node.exe'), (Join-Path $engine 'backup.cjs'), (Join-Path $engine 'NODE-LICENSE.txt'))) {
    if (!(Test-Path -LiteralPath $file -PathType Leaf)) { throw "Missing $file. Build a fresh x64 release first." }
}
foreach ($binary in @($exe, (Join-Path $engine 'node.exe'))) {
    $stream = [System.IO.File]::OpenRead($binary)
    $reader = [System.IO.BinaryReader]::new($stream)
    try {
        if ($reader.ReadUInt16() -ne 0x5A4D) { throw "Invalid executable: $binary" }
        $stream.Position = 0x3C
        $offset = $reader.ReadInt32()
        $stream.Position = $offset
        if ($reader.ReadUInt32() -ne 0x4550 -or $reader.ReadUInt16() -ne 0x8664) {
            throw "Expected an x64 Windows executable: $binary"
        }
    } finally { $reader.Dispose(); $stream.Dispose() }
}
# Each attempt uses a new folder; never delete an existing package or copy a user profile.
$output = Join-Path $root ('.store-output/' + [guid]::NewGuid().ToString('N'))
$stage = Join-Path $output 'layout'
$app = Join-Path $stage 'Bmail'
$assets = Join-Path $stage 'Assets'
New-Item -ItemType Directory -Path $app, $assets -Force | Out-Null
Copy-Item -LiteralPath $exe -Destination $app
Copy-Item -LiteralPath $engine -Destination $app -Recurse
Copy-Item -LiteralPath (Join-Path $root 'LICENSE') -Destination $app
$manifest = Get-Content -LiteralPath (Join-Path $root 'packaging/store/AppxManifest.xml') -Raw
foreach ($entry in @{
    '__IDENTITY_NAME__' = $IdentityName
    '__IDENTITY_PUBLISHER__' = $IdentityPublisher
    '__PUBLISHER_DISPLAY_NAME__' = $PublisherDisplayName
    '__VERSION__' = $version
}.GetEnumerator()) {
    $manifest = $manifest.Replace($entry.Key, [System.Security.SecurityElement]::Escape($entry.Value))
}
[System.IO.File]::WriteAllText((Join-Path $stage 'AppxManifest.xml'), $manifest, [System.Text.UTF8Encoding]::new($false))
Add-Type -AssemblyName System.Drawing
$source = [System.Drawing.Image]::FromFile((Join-Path $root 'src-tauri/icons/icon.png'))
try {
    foreach ($entry in @{ 'StoreLogo.png' = 50; 'Square44x44Logo.png' = 44; 'Square150x150Logo.png' = 150 }.GetEnumerator()) {
        $bitmap = [System.Drawing.Bitmap]::new($entry.Value, $entry.Value)
        $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
        try {
            $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $graphics.DrawImage($source, 0, 0, $entry.Value, $entry.Value)
            $bitmap.Save((Join-Path $assets $entry.Key), [System.Drawing.Imaging.ImageFormat]::Png)
        } finally { $graphics.Dispose(); $bitmap.Dispose() }
    }
} finally { $source.Dispose() }
$package = Join-Path $output "Bmail_$($version)_x64.msix"
& $makeappx.FullName pack /d $stage /p $package /o
if ($LASTEXITCODE -ne 0) { throw 'MakeAppx validation or packaging failed.' }
Write-Output "Unsigned Store package: $package"
Write-Output 'Not installed or submitted. Complete the MSIX compatibility checklist before upload.'
