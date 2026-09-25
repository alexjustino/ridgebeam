//! The settings table: key, value, and when it last changed.
//!
//! This module has no opinion about which settings exist or what they may hold.
//! That list is the host's, in `commands/settings.rs`, and it is what every
//! write goes through — here a key is a string and a value is a string, exactly
//! as they are in the file. Keeping the repository ignorant is what lets the
//! list grow with the interface without a migration.
//!
//! Every statement is parametrised. A key never reaches SQLite as text spliced
//! into a statement, even though the only keys that get this far came off a
//! closed list — a repository that is safe only because of who calls it is one
//! rename away from not being.

use rusqlite::{Connection, OptionalExtension};

use crate::db::now;
use crate::error::Result;

/// What one setting is worth, or `None` when it has never been set.
///
/// # Errors
///
/// [`crate::error::Error::Database`] when the table could not be read.
pub fn get(conn: &Connection, key: &str) -> Result<Option<String>> {
    let found = conn
        .query_row("SELECT value FROM settings WHERE key = ?1", [key], |row| {
            row.get::<_, String>(0)
        })
        .optional()?;
    Ok(found)
}

/// Write one setting, replacing what was there.
///
/// An upsert rather than a delete and an insert: the row is the setting, and a
/// reader must never find the moment in between, when the person has no theme
/// at all.
///
/// # Errors
///
/// [`crate::error::Error::Database`] when the row could not be written —
/// including a key or a value the schema's own bounds refuse.
pub fn set(conn: &Connection, key: &str, value: &str) -> Result<()> {
    conn.execute(
        "INSERT INTO settings (key, value, updated_at)
         VALUES (?1, ?2, ?3)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value,
                                         updated_at = excluded.updated_at",
        rusqlite::params![key, value, now()],
    )?;
    Ok(())
}

/// Every setting that has been written, by key.
///
/// # Errors
///
/// [`crate::error::Error::Database`] when the table could not be read.
pub fn all(conn: &Connection) -> Result<Vec<(String, String)>> {
    let mut statement = conn.prepare("SELECT key, value FROM settings ORDER BY key ASC")?;
    let found = statement
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(found)
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
    fn a_setting_that_was_never_written_is_an_answer_not_an_error() {
        let conn = workspace();

        assert_eq!(get(&conn, "theme").expect("get"), None);
        assert!(all(&conn).expect("all").is_empty());
    }

    #[test]
    fn writing_again_replaces_the_value_and_leaves_one_row() {
        let conn = workspace();
        set(&conn, "theme", "light").expect("set");
        set(&conn, "theme", "dark").expect("set again");

        assert_eq!(get(&conn, "theme").expect("get").as_deref(), Some("dark"));
        assert_eq!(
            all(&conn).expect("all").len(),
            1,
            "a setting is one row, not a history"
        );
    }

    /// Every statement here is parametrised, so a key is a key even when it
    /// reads like SQL.
    #[test]
    fn a_key_that_reads_like_sql_is_stored_as_a_key() {
        let conn = workspace();
        let hostile = "theme'; DROP TABLE settings; --";

        set(&conn, hostile, "dark").expect("set");

        assert_eq!(get(&conn, hostile).expect("get").as_deref(), Some("dark"));
        let found: i64 = conn
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE name = 'settings'",
                [],
                |r| r.get(0),
            )
            .expect("read the schema");
        assert_eq!(found, 1, "`settings` must still be there");
    }

    /// The bounds are in the schema as well as in the host.
    #[test]
    fn the_database_refuses_a_key_or_a_value_it_cannot_hold() {
        let conn = workspace();
        let long_key = "k".repeat(65);
        let long_value = "v".repeat(4097);

        for (case, key, value) in [
            ("a key of nothing", "", "dark"),
            ("a key of 65 characters", long_key.as_str(), "dark"),
            ("a value of 4097 characters", "theme", long_value.as_str()),
        ] {
            let refused = set(&conn, key, value).expect_err(case);
            assert_eq!(
                refused.kind(),
                "database",
                "{case} must be refused by the schema"
            );
        }

        set(&conn, &"k".repeat(64), &"v".repeat(4096)).expect("the largest pair there is");
    }
}
