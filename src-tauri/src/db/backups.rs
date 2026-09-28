//! When each work was last backed up, in the application database.
//!
//! One row per work, replaced by the next backup (application migration 003).
//! Nothing about the backup's contents, and not where it went: the file is the
//! person's.

use rusqlite::{Connection, OptionalExtension};

use crate::db::now;
use crate::error::Result;

/// Record that a backup of `work_id` was written on `day` (local, the
/// person's calendar), `bytes` long, holding `files` files.
///
/// # Errors
///
/// [`crate::error::Error::Database`] when the row could not be written.
pub fn record(conn: &Connection, work_id: &str, day: &str, bytes: u64, files: usize) -> Result<()> {
    conn.execute(
        "INSERT INTO backup (work_id, day, written_at, bytes, files)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT (work_id) DO UPDATE SET day = excluded.day,
                                             written_at = excluded.written_at,
                                             bytes = excluded.bytes,
                                             files = excluded.files",
        rusqlite::params![work_id, day, now(), bytes as i64, files as i64],
    )?;
    Ok(())
}

/// The day of the last backup of `work_id`, or `None` for never.
///
/// # Errors
///
/// [`crate::error::Error::Database`] when the table could not be read.
pub fn last(conn: &Connection, work_id: &str) -> Result<Option<String>> {
    Ok(conn
        .query_row(
            "SELECT day FROM backup WHERE work_id = ?1",
            [work_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{migrations, new_id};

    #[test]
    fn the_last_backup_is_kept_per_work_and_replaced_by_the_next() {
        let conn = Connection::open_in_memory().unwrap();
        migrations::APP.apply(&conn).unwrap();
        let (a, b) = (new_id(), new_id());

        assert_eq!(last(&conn, &a).unwrap(), None, "never");
        record(&conn, &a, "2026-10-08", 1000, 3).unwrap();
        record(&conn, &b, "2026-10-01", 10, 1).unwrap();
        record(&conn, &a, "2026-10-09", 2000, 4).unwrap();

        assert_eq!(last(&conn, &a).unwrap().as_deref(), Some("2026-10-09"));
        assert_eq!(last(&conn, &b).unwrap().as_deref(), Some("2026-10-01"));
        let rows: i64 = conn
            .query_row("SELECT count(*) FROM backup", [], |r| r.get(0))
            .unwrap();
        assert_eq!(rows, 2, "one row per work");
        assert!(
            record(&conn, "short", "2026-10-09", 1, 1).is_err(),
            "a work id is a UUID"
        );
    }
}
