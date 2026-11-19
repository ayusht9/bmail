fn main() {
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
