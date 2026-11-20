pub const UNAVAILABLE: &str = "Microsoft sign-in is not set up for this Bmail build. Outlook accounts cannot be connected yet.";

pub fn valid_client_id(value: &str) -> bool {
    value.len() == 36 && value.bytes().enumerate().all(|(index, byte)| {
        if [8, 13, 18, 23].contains(&index) { byte == b'-' } else { byte.is_ascii_hexdigit() }
    }) && value.bytes().any(|byte| byte != b'0' && byte != b'-')
}

pub fn configured_client_id() -> Option<&'static str> {
    option_env!("BMAIL_MICROSOFT_CLIENT_ID").map(str::trim).filter(|value| valid_client_id(value))
}

pub fn required_client_id() -> Result<&'static str, String> {
    configured_client_id().ok_or_else(|| UNAVAILABLE.to_owned())
}

pub fn outlook_host(host: &str) -> bool {
    let host = host.trim().to_ascii_lowercase();
    matches!(host.as_str(), "outlook.office365.com" | "imap-mail.outlook.com") || host.split_once('.').is_some_and(|(name, suffix)| {
        ["outlook", "hotmail", "live", "msn"].contains(&name) && ["com", "in", "co.uk"].contains(&suffix)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn accepts_only_nonzero_client_ids_with_the_correct_guid_structure() {
        assert!(valid_client_id("11111111-2222-3333-4444-555555555555"));
        for value in ["", "outlook@example.com", "------------------------------------", "00000000-0000-0000-0000-000000000000", "111111112222-3333-4444-55555555555555"] {
            assert!(!valid_client_id(value));
        }
    }
    #[test]
    fn recognizes_outlook_hosts_without_matching_similar_custom_servers() {
        assert!(outlook_host(" OUTLOOK.IN "));
        assert!(outlook_host("outlook.office365.com"));
        assert!(!outlook_host("outlook.com.example.test"));
        assert!(!outlook_host("imap.example.test"));
    }
}
