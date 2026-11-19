use std::{fs, io, path::{Component, Path, PathBuf}};

pub fn account_folder(base: &Path, email: &str) -> PathBuf {
    let normalized = email.trim().to_lowercase();
    let mut name = String::new();
    for byte in normalized.bytes() {
        if byte.is_ascii_alphanumeric() || b"@._+-".contains(&byte) { name.push(byte as char); }
        else { name.push_str(&format!("%{byte:02X}")); }
    }
    if name.ends_with('.') { name.pop(); name.push_str("%2E"); }
    base.join("accounts").join(name)
}

/// Resolve an account only inside the application's accounts directory.
pub fn checked_account_folder(base: &Path, email: &str) -> io::Result<PathBuf> {
    let base = fs::canonicalize(base)?;
    let accounts = fs::canonicalize(base.join("accounts"))?;
    let requested = account_folder(&base, email);
    let root = fs::canonicalize(&requested)?;
    if fs::symlink_metadata(base.join("accounts"))?.file_type().is_symlink()
        || accounts.parent() != Some(base.as_path()) || root.parent() != Some(accounts.as_path())
        || fs::symlink_metadata(&requested)?.file_type().is_symlink() || !root.is_dir() {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, "The mailbox folder resolves outside its account directory."));
    }
    Ok(root)
}

/// Remove an account from the active list, retaining its data separately.
/// Validate all resolved paths before moving data or deleting credentials.
pub fn retire_account(base: &Path, email: &str) -> io::Result<PathBuf> {
    let root = checked_account_folder(base, email)?;
    let base = fs::canonicalize(base)?;
    let private = root.join(".private");
    let mut secrets = Vec::new();
    if private.exists() {
        let resolved = fs::canonicalize(&private)?;
        if resolved.parent() != Some(root.as_path()) || fs::symlink_metadata(&private)?.file_type().is_symlink() {
            return Err(io::Error::new(io::ErrorKind::InvalidInput, "Saved credentials resolve outside the mailbox folder."));
        }
        for entry in fs::read_dir(&private)? {
            let entry = entry?;
            if !entry.file_type()?.is_file() || fs::canonicalize(entry.path())?.parent() != Some(resolved.as_path()) {
                return Err(io::Error::new(io::ErrorKind::InvalidInput, "The credential directory contains an unexpected entry."));
            }
            secrets.push(entry.file_name());
        }
    }
    let retained = base.join("removed-accounts");
    fs::create_dir_all(&retained)?;
    if fs::symlink_metadata(&retained)?.file_type().is_symlink() {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, "The retained-data folder must not be a link."));
    }
    let retained = fs::canonicalize(retained)?;
    if retained.parent() != Some(base.as_path()) {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, "The retained-data folder resolves outside Bmail."));
    }
    let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)
        .map_err(io::Error::other)?.as_nanos();
    let destination = retained.join(format!("{}-{stamp}", root.file_name().unwrap().to_string_lossy()));
    if destination.exists() { return Err(io::Error::new(io::ErrorKind::AlreadyExists, "Retained mailbox data already exists.")); }
    fs::rename(&root, &destination)?;
    let cleared: io::Result<()> = (|| {
        let private = destination.join(".private");
        for name in secrets { fs::remove_file(private.join(name))?; }
        if private.exists() { fs::remove_dir(private)?; }
        Ok(())
    })();
    if let Err(error) = cleared {
        if fs::rename(&destination, &root).is_err() {
            return Err(io::Error::other(format!("Mailbox data was retained at {} but credentials could not be cleared: {error}", destination.display())));
        }
        return Err(io::Error::other(format!("Could not clear saved credentials. Mailbox data was kept: {error}")));
    }
    Ok(destination)
}

/// Move only application data; keep the old WebView cache and app installation.
/// Configuration moves last so an interrupted migration can be retried.
pub fn migrate(legacy: &Path, destination: &Path, backup_relative: Option<&Path>) -> io::Result<bool> {
    if !legacy.join("backup-config.json").is_file() || destination.join("backup-config.json").exists() { return Ok(false); }
    fs::create_dir_all(destination)?;
    let legacy = fs::canonicalize(legacy)?;
    let destination = fs::canonicalize(destination)?;
    if destination.starts_with(&legacy) || legacy.starts_with(&destination) {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, "Data folders must be separate."));
    }
    let mut entries = vec![PathBuf::from(".private"), PathBuf::from("logs")];
    if let Some(relative) = backup_relative {
        if relative.as_os_str().is_empty() || relative.components().any(|c| !matches!(c, Component::Normal(_))) {
            return Err(io::Error::new(io::ErrorKind::InvalidInput, "A custom backup path needs manual migration."));
        }
        if !entries.contains(&relative.to_path_buf()) { entries.push(relative.to_path_buf()); }
    }
    entries.push(PathBuf::from("backup-config.json"));
    // Check all conflicts and resolved source boundaries before moving anything.
    for relative in &entries {
        let source = legacy.join(relative);
        if source.exists() {
            if !fs::canonicalize(&source)?.starts_with(&legacy) {
                return Err(io::Error::new(io::ErrorKind::InvalidInput, "Legacy data resolves outside its data folder."));
            }
            if destination.join(relative).exists() {
                return Err(io::Error::new(io::ErrorKind::AlreadyExists, "Bmail already contains data with the same name. Neither copy was overwritten."));
            }
        }
    }
    for relative in entries {
        let source = legacy.join(&relative);
        let target = destination.join(&relative);
        if source.exists() {
            let mut parent = destination.clone();
            let components: Vec<_> = relative.components().collect();
            for component in &components[..components.len() - 1] {
                parent.push(component.as_os_str());
                if !parent.exists() { fs::create_dir(&parent)?; }
                if !fs::canonicalize(&parent)?.starts_with(&destination) {
                    return Err(io::Error::new(io::ErrorKind::InvalidInput, "Bmail data resolves outside its data folder."));
                }
            }
            fs::rename(&source, &target)?;
        }
    }
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("bmail-migration-{}-{}", std::process::id(), name));
        fs::create_dir_all(root.join("old/backups" )).unwrap();
        fs::create_dir_all(root.join("old/.private")).unwrap();
        fs::create_dir_all(root.join("old/EBWebView")).unwrap();
        fs::write(root.join("old/backup-config.json"), b"{\"backupDirectory\":\"backups\"}").unwrap();
        fs::write(root.join("old/backups/message.eml"), b"original email bytes").unwrap();
        fs::write(root.join("old/.private/zoho-credential.xml"), b"opaque encrypted bytes").unwrap();
        root
    }
    #[test]
    fn account_names_are_readable_and_cannot_escape_the_accounts_folder() {
        let base = Path::new("Bmail");
        assert_eq!(account_folder(base, "User.Name+tag@gmail.com"), base.join("accounts/user.name+tag@gmail.com"));
        assert_eq!(account_folder(base, "../odd/name@example.com"), base.join("accounts/..%2Fodd%2Fname@example.com"));
        assert_ne!(account_folder(base, "a?@example.com"), account_folder(base, "a%@example.com"));
    }
    #[test]
    fn moves_mail_and_encrypted_credentials_once_and_keeps_browser_cache() {
        let root = fixture("move");
        assert!(migrate(&root.join("old"), &root.join("Bmail"), Some(Path::new("backups"))).unwrap());
        assert_eq!(fs::read(root.join("Bmail/backups/message.eml")).unwrap(), b"original email bytes");
        assert_eq!(fs::read(root.join("Bmail/.private/zoho-credential.xml")).unwrap(), b"opaque encrypted bytes");
        assert!(root.join("old/EBWebView").is_dir());
        assert!(!migrate(&root.join("old"), &root.join("Bmail"), Some(Path::new("backups"))).unwrap());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn refuses_conflicting_data_without_moving_the_credential_or_configuration() {
        let root = fixture("conflict");
        fs::create_dir_all(root.join("Bmail/backups")).unwrap();
        assert!(migrate(&root.join("old"), &root.join("Bmail"), Some(Path::new("backups"))).is_err());
        assert!(root.join("old/backup-config.json").is_file());
        assert!(root.join("old/.private/zoho-credential.xml").is_file());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn refuses_a_relative_path_that_escapes_the_legacy_folder() {
        let root = fixture("escape");
        assert!(migrate(&root.join("old"), &root.join("Bmail"), Some(Path::new("../other"))).is_err());
        assert!(root.join("old/backup-config.json").is_file());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn removal_keeps_mail_and_other_accounts_but_clears_saved_credentials() {
        let base = std::env::temp_dir().join(format!("bmail-remove-{}", std::process::id()));
        let email = "fixture@example.com";
        let root = account_folder(&base, email);
        let other = account_folder(&base, "other@example.com");
        fs::create_dir_all(root.join("backups")).unwrap();
        fs::create_dir_all(root.join(".private")).unwrap();
        fs::create_dir_all(&other).unwrap();
        fs::write(root.join("backup-config.json"), br#"{"user":"fixture@example.com"}"#).unwrap();
        fs::write(root.join("backups/email.eml"), b"original message bytes").unwrap();
        fs::write(root.join(".private/zoho-credential.xml"), b"encrypted token").unwrap();
        fs::write(root.join(".private/zoho-credential.xml.pending"), b"pending token").unwrap();
        fs::write(other.join("backup-config.json"), b"other account").unwrap();
        let retained = retire_account(&base, email).unwrap();
        assert!(!root.exists());
        assert_eq!(fs::read(retained.join("backups/email.eml")).unwrap(), b"original message bytes");
        assert!(!retained.join(".private").exists());
        assert_eq!(fs::read(other.join("backup-config.json")).unwrap(), b"other account");
        assert!(retire_account(&base, email).is_err());
        fs::remove_dir_all(base).unwrap();
    }
    #[test]
    fn removal_refuses_unexpected_private_directories_before_moving_data() {
        let base = std::env::temp_dir().join(format!("bmail-remove-invalid-{}", std::process::id()));
        let root = account_folder(&base, "fixture@example.com");
        fs::create_dir_all(root.join(".private/unexpected")).unwrap();
        fs::write(root.join("backup-config.json"), b"original config").unwrap();
        assert!(retire_account(&base, "fixture@example.com").is_err());
        assert_eq!(fs::read(root.join("backup-config.json")).unwrap(), b"original config");
        fs::remove_dir_all(base).unwrap();
    }

}
