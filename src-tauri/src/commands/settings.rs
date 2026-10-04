//! The commands the Settings screen calls: read the settings, change one.
//!
//! The list below is the schema of the settings. Not the table — the table
//! holds a key and a value and has no opinion (application migration 002) —
//! but this array, in code, next to the commands that enforce it. A key not on
//! it is `settings_key`, so the table is the set of choices this product offers
//! and never a place the interface can leave notes for itself. A value that
//! does not fit its key is `invalid_input`, with the choices spelled out.
//!
//! The read side checks the same rules. A stored value that does not fit — a
//! file edited by hand, or written by a newer build that knows a choice this
//! one does not — reads as the default, and the row is left where it is. What
//! comes out of this boundary is always something that could have gone in.
//!
//! # Changelog of this boundary
//!
//! - F0: `settings_get` and `settings_set` over three keys — language, theme
//!   and lens. Every key has a default, so the reply is always whole.

use rusqlite::Connection;
use tauri::State;

use crate::contract::Settings;
use crate::db::{settings, Db};
use crate::error::{Error, Result};

/// A setting: its key, the values it may hold, and the one it holds until
/// somebody chooses.
struct Rule {
    key: &'static str,
    allowed: &'static [&'static str],
    default: &'static str,
}

/// Every setting this product keeps. Closed, on purpose.
const RULES: &[Rule] = &[
    Rule {
        key: "language",
        allowed: &["system", "en", "pt-BR"],
        default: "system",
    },
    Rule {
        key: "theme",
        allowed: &["system", "light", "dark"],
        default: "system",
    },
    Rule {
        key: "lens",
        allowed: &["owner", "architect", "engineer"],
        default: "owner",
    },
];

/// Every setting, each at its chosen value or its default.
///
/// # Errors
///
/// [`Error::Database`] when the table cannot be read.
#[tauri::command(rename_all = "snake_case")]
pub fn settings_get(db: State<'_, Db>) -> Result<Settings> {
    settings_get_with(&db.conn())
}

/// Change one setting; returns every setting as it now is.
///
/// # Errors
///
/// [`Error::SettingsKey`] when the key is not a setting this product keeps;
/// [`Error::InvalidInput`] when the value is not one the key allows;
/// [`Error::Database`] when the row cannot be written.
#[tauri::command(rename_all = "snake_case")]
pub fn settings_set(db: State<'_, Db>, key: String, value: String) -> Result<Settings> {
    settings_set_with(&db.conn(), &key, &value)
}

/// What [`settings_get`] does once the database is in hand.
pub fn settings_get_with(conn: &Connection) -> Result<Settings> {
    Ok(Settings {
        language: read(conn, &RULES[0])?,
        theme: read(conn, &RULES[1])?,
        lens: read(conn, &RULES[2])?,
    })
}

/// What [`settings_set`] does once the database is in hand.
pub fn settings_set_with(conn: &Connection, key: &str, value: &str) -> Result<Settings> {
    let rule = RULES
        .iter()
        .find(|rule| rule.key == key)
        .ok_or(Error::SettingsKey)?;
    if !rule.allowed.contains(&value) {
        return Err(Error::InvalidInput(format!(
            "The {key} is {}.",
            in_words(rule.allowed)
        )));
    }
    settings::set(conn, key, value)?;
    log::info!("the setting `{key}` is now `{value}`");
    settings_get_with(conn)
}

/// A stored value, or the default when there is none this build accepts.
fn read(conn: &Connection, rule: &Rule) -> Result<String> {
    let value = match settings::get(conn, rule.key)? {
        Some(stored) if rule.allowed.contains(&stored.as_str()) => stored,
        Some(_) => {
            log::warn!(
                "the stored value of `{}` is not one this build accepts; the default is used",
                rule.key
            );
            rule.default.to_string()
        }
        None => rule.default.to_string(),
    };
    Ok(value)
}

/// A list of words as a person reads one: `a, b or c`.
fn in_words(words: &[&str]) -> String {
    match words {
        [] => String::new(),
        [only] => (*only).to_string(),
        [rest @ .., last] => format!("{} or {last}", rest.join(", ")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrations;

    fn workspace() -> Connection {
        let conn = Connection::open_in_memory().expect("in-memory database");
        migrations::APP.apply(&conn).expect("migrate");
        conn
    }

    #[test]
    fn a_setting_nobody_chose_reads_as_its_default() {
        let conn = workspace();

        assert_eq!(
            settings_get_with(&conn).unwrap(),
            Settings {
                language: "system".into(),
                theme: "system".into(),
                lens: "owner".into(),
            }
        );
    }

    #[test]
    fn every_value_of_every_key_round_trips_and_the_reply_is_every_setting() {
        let conn = workspace();

        for rule in RULES {
            for value in rule.allowed {
                let reply = settings_set_with(&conn, rule.key, value).expect("set");
                let reply = serde_json::to_value(reply).unwrap();
                assert_eq!(reply[rule.key], *value);
                assert_eq!(reply.as_object().unwrap().len(), 3);
            }
        }
        assert_eq!(
            settings_get_with(&conn).unwrap(),
            Settings {
                language: "pt-BR".into(),
                theme: "dark".into(),
                lens: "engineer".into(),
            }
        );
    }

    #[test]
    fn a_key_that_is_not_a_setting_is_refused_as_settings_key() {
        let conn = workspace();

        for key in [
            "",
            "Theme",
            "theme ",
            "locale",
            "progress",
            "theme'; DROP TABLE settings; --",
        ] {
            let refused = settings_set_with(&conn, key, "dark").expect_err("not a setting");
            assert_eq!(refused.kind(), "settings_key", "`{key}`");
        }
        assert!(
            settings::all(&conn).unwrap().is_empty(),
            "and no row was written"
        );
    }

    #[test]
    fn a_value_the_key_does_not_allow_is_refused_with_the_choices() {
        let conn = workspace();

        for (key, value, sentence) in [
            ("theme", "midnight", "The theme is system, light or dark."),
            ("theme", "Dark", "The theme is system, light or dark."),
            ("language", "pt", "The language is system, en or pt-BR."),
            ("language", "pt-br", "The language is system, en or pt-BR."),
            (
                "lens",
                "contractor",
                "The lens is owner, architect or engineer.",
            ),
            ("lens", "", "The lens is owner, architect or engineer."),
        ] {
            let refused = settings_set_with(&conn, key, value).expect_err("does not fit");
            assert_eq!(refused.kind(), "invalid_input");
            assert_eq!(refused.to_string(), sentence);
        }
        assert!(
            settings::all(&conn).unwrap().is_empty(),
            "and no row was written"
        );
    }

    #[test]
    fn a_stored_value_this_build_does_not_accept_reads_as_the_default_and_stays_in_the_file() {
        let conn = workspace();
        settings::set(&conn, "theme", "midnight").expect("behind the command's back");

        assert_eq!(settings_get_with(&conn).unwrap().theme, "system");
        assert_eq!(
            settings::get(&conn, "theme").unwrap().as_deref(),
            Some("midnight")
        );
    }
}
