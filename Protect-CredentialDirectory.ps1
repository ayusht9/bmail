function Protect-CredentialDirectory {
    param([Parameter(Mandatory = $true)][string]$LiteralPath)

    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    # Build a DACL-only descriptor. Get-Acl/Set-Acl may also try to persist the
    # audit section (SACL), which requires SeSecurityPrivilege.
    $access = New-Object Security.AccessControl.DirectorySecurity
    $access.SetAccessRuleProtection($true, $false)
    $rule = New-Object Security.AccessControl.FileSystemAccessRule(
        $identity.User, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
    $access.AddAccessRule($rule)
    [IO.Directory]::SetAccessControl($LiteralPath, $access)
}
