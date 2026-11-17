param([int]$TestProcessId, [long]$MainHandle = 0, [ValidateSet('inspect', 'close', 'restore')][string]$Action = 'inspect')
$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class BmailTestWindow {
    public delegate bool Callback(IntPtr handle, IntPtr parameter);
    [DllImport("user32.dll")] public static extern bool EnumWindows(Callback callback, IntPtr parameter);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr handle, out uint processId);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr handle, StringBuilder text, int count);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr handle, StringBuilder text, int count);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr handle);
    [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr handle, uint message, IntPtr wparam, IntPtr lparam);
}
'@
$script:main = [IntPtr]$MainHandle
$script:tray = [IntPtr]::Zero
$script:splash = $false
[BmailTestWindow]::EnumWindows({
    param($handle, $parameter)
    [uint32]$owner = 0
    [void][BmailTestWindow]::GetWindowThreadProcessId($handle, [ref]$owner)
    if ($owner -eq $TestProcessId) {
        $title = [Text.StringBuilder]::new(512)
        $class = [Text.StringBuilder]::new(256)
        [void][BmailTestWindow]::GetWindowText($handle, $title, $title.Capacity)
        [void][BmailTestWindow]::GetClassName($handle, $class, $class.Capacity)
        if ($title.ToString() -like 'Bmail*') { $script:main = $handle }
        if ($title.ToString() -eq 'Starting Bmail') { $script:splash = $true }
        if ($class.ToString() -eq 'tray_icon_app') { $script:tray = $handle }
    }
    return $true
}, [IntPtr]::Zero) | Out-Null
if ($script:main -eq [IntPtr]::Zero) { throw 'The fixture main window is missing.' }
if ($Action -eq 'close') {
    [void][BmailTestWindow]::PostMessage($script:main, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)
} elseif ($Action -eq 'restore') {
    if ($script:tray -eq [IntPtr]::Zero) { throw 'The fixture tray window is missing.' }
    # tray-icon 0.25 dispatches Shell left-button-up through message 6002.
    # Send it only to this fixture process, exercising the real tray callback.
    [void][BmailTestWindow]::PostMessage($script:tray, 6002, [IntPtr]::Zero, [IntPtr]0x0202)
}
if ($Action -ne 'inspect') { Start-Sleep -Milliseconds 350 }
$text = [Text.StringBuilder]::new(512)
[void][BmailTestWindow]::GetWindowText($script:main, $text, $text.Capacity)
@{
    main = $script:main.ToInt64()
    tray = $script:tray.ToInt64()
    visible = [BmailTestWindow]::IsWindowVisible($script:main)
    title = $text.ToString()
    splash = $script:splash
} | ConvertTo-Json -Compress
