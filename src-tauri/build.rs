fn main() {
    println!("cargo:rerun-if-env-changed=BMAIL_DROPBOX_APP_KEY");
    println!("cargo:rerun-if-changed=../.env.local");
    // Release CI supplies the public desktop client identifier as an env var.
    // Local registration details stay in the ignored workspace .env.local.
    let local = std::fs::read_to_string("../.env.local").ok();
    let dropbox_key = std::env::var("BMAIL_DROPBOX_APP_KEY").ok().filter(|v| !v.trim().is_empty()).or_else(|| {
        local.as_deref()?.lines().find_map(|line| {
            let (name, value) = line.trim().split_once('=')?;
            (name.trim() == "BMAIL_DROPBOX_APP_KEY").then(|| value.trim().trim_matches(['\'', '"']).to_owned())
        }).filter(|v| !v.is_empty())
    });
    if let Some(value) = dropbox_key {
        let value = value.trim();
        assert!((8..=80).contains(&value.len()) && value.bytes().all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b)), "BMAIL_DROPBOX_APP_KEY must be a valid Dropbox desktop app key.");
        println!("cargo:rustc-env=BMAIL_DROPBOX_APP_KEY={value}");
    }
    println!("cargo:rerun-if-env-changed=BMAIL_MICROSOFT_CLIENT_ID");
    if let Ok(value) = std::env::var("BMAIL_MICROSOFT_CLIENT_ID") {
        let value = value.trim();
        let valid = value.len() == 36 && value.bytes().enumerate().all(|(index, byte)| {
            if [8, 13, 18, 23].contains(&index) { byte == b'-' } else { byte.is_ascii_hexdigit() }
        }) && value.bytes().any(|byte| byte != b'0' && byte != b'-');
        assert!(valid, "BMAIL_MICROSOFT_CLIENT_ID must be Bmail's registered Application (client) ID.");
        println!("cargo:rustc-env=BMAIL_MICROSOFT_CLIENT_ID={value}");
    }
    tauri_build::build()
}
