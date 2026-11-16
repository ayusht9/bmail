$ErrorActionPreference = 'Stop'
try {
    [Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
    $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
    Add-Type -AssemblyName System.Windows.Forms
    $dialog = New-Object System.Windows.Forms.SaveFileDialog
    $dialog.FileName = $request.name
    $dialog.AddExtension = $true
    $dialog.OverwritePrompt = $true
    if ($request.zip) { $dialog.Filter = 'ZIP archive (*.zip)|*.zip'; $dialog.DefaultExt = 'zip' }
    else { $dialog.Filter = 'Email message (*.eml)|*.eml'; $dialog.DefaultExt = 'eml' }
    if ($dialog.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { exit 0 }
    $destination = $dialog.FileName
    foreach ($source in $request.files) {
        if ([string]::Equals([IO.Path]::GetFullPath($source), [IO.Path]::GetFullPath($destination), [StringComparison]::OrdinalIgnoreCase)) {
            throw 'Choose a destination outside the original email file.'
        }
    }
    # Finish the export before replacing an existing destination.
    $temporary = Join-Path ([IO.Path]::GetDirectoryName($destination)) ([IO.Path]::GetRandomFileName())
    try {
        if ($request.zip) {
            Add-Type -AssemblyName System.IO.Compression
            Add-Type -AssemblyName System.IO.Compression.FileSystem
            $archive = [IO.Compression.ZipFile]::Open($temporary, [IO.Compression.ZipArchiveMode]::Create)
            try {
                $index = 0
                foreach ($source in $request.files) {
                    $index++
                    $entry = '{0:D6}-{1}' -f $index, [IO.Path]::GetFileName($source)
                    [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $source, $entry) | Out-Null
                }
            } finally { $archive.Dispose() }
        } else { [IO.File]::Copy($request.files[0], $temporary) }
        [IO.File]::Copy($temporary, $destination, $true)
    } finally { if ($temporary -and [IO.File]::Exists($temporary)) { [IO.File]::Delete($temporary) } }
    $dialog.Dispose()
    [Console]::WriteLine('saved')
} catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }
