//! The name a diary entry is signed with: the Windows account's display name.
//!
//! The product has no accounts, no login and no users of its own. An entry
//! records who wrote it as the operating system knows them — the display name
//! of the signed-in account ("Ana Souza"), or, where Windows has none to give
//! (a local account with no full name), the account name ("ana"). It is a
//! label, not an identity: anybody signed in as that account writes as them,
//! and the diary's chain proves only that the words were not changed later.
//!
//! Never empty: if the system cannot be asked at all, the entry is signed
//! "Unknown account" rather than refused — a day on site is not lost because a
//! name could not be read.

/// What an entry is signed with when the system gives no name.
pub const UNKNOWN: &str = "Unknown account";

/// The longest name kept; the schema allows 256.
const MAX_CHARS: usize = 256;

/// The signed-in account's display name, or its account name, or [`UNKNOWN`].
pub fn display_name() -> String {
    let found = display_name_from_system()
        .or_else(|| std::env::var("USERNAME").ok())
        .map(|name| name.trim().chars().take(MAX_CHARS).collect::<String>())
        .filter(|name| !name.is_empty());
    found.unwrap_or_else(|| UNKNOWN.to_string())
}

#[cfg(windows)]
fn display_name_from_system() -> Option<String> {
    use windows::core::PWSTR;
    use windows::Win32::Security::Authentication::Identity::{GetUserNameExW, NameDisplay};

    let mut size: u32 = 0;
    // The first call asks how long the name is; it fails by design.
    // SAFETY: a null buffer with a size of 0 is the documented way to ask.
    unsafe {
        let _ = GetUserNameExW(NameDisplay, PWSTR::null(), &mut size);
    }
    if size == 0 || size > 1024 {
        return None;
    }
    let mut buffer = vec![0u16; size as usize];
    // SAFETY: `buffer` holds `size` UTF-16 units, as the call was told.
    let ok = unsafe { GetUserNameExW(NameDisplay, PWSTR(buffer.as_mut_ptr()), &mut size) };
    if !ok.as_bool() {
        return None;
    }
    let written = (size as usize).min(buffer.len());
    Some(
        String::from_utf16_lossy(&buffer[..written])
            .trim_end_matches(char::from(0))
            .to_string(),
    )
}

#[cfg(not(windows))]
fn display_name_from_system() -> Option<String> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_account_name_is_never_empty_and_never_longer_than_the_schema_keeps() {
        let name = display_name();
        assert!(!name.trim().is_empty());
        assert!(name.chars().count() <= MAX_CHARS);
        assert!(!name.contains('\0'), "no terminator carried into the name");
    }
}
