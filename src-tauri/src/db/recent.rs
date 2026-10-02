//! The list of recent works, in the application database.
//!
//! A row is a work as it was last seen — its identity, its name and its folder —
//! and never anything from inside it. The folder may have moved or gone since;
//! whether it is still there is asked of the disk when the list is read, not
//! stored, because a stored answer is stale the moment somebody moves a folder.

use rusqlite::Connection;

use crate::db::now;
use crate::error::Result;

/// How many works the list keeps. The oldest beyond this are forgotten — the
/// work itself is untouched; it is only no longer in the list.
pub const KEEP: i64 = 20;

/// One row of the list, as stored.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Row {
    /// The work's UUID.
    pub work_id: String,
    /// Its name, as last seen.
    pub name: String,
    /// Its folder, as last seen.
    pub folder: String,
    /// When it was last opened or created, UTC.
    pub opened_at: String,
}

/// Record that a work was opened (or created) now, from this folder.
///
/// One row per work: opening it again moves it to the top and takes the name
/// and folder it has now. A different work that was last seen in the same
/// folder is forgotten, because that folder now holds this one.
///
/// # Errors
///
/// [`crate::error::Error::Database`] when the row could not be written.
pub fn record(conn: &Connection, work_id: &str, name: &str, folder: &str) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "DELETE FROM recent_work WHERE folder = ?1 AND work_id <> ?2",
        [folder, work_id],
    )?;
    tx.execute(
        "INSERT INTO recent_work (work_id, name, folder, opened_at)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT (work_id) DO UPDATE SET name = excluded.name,
                                             folder = excluded.folder,
                                             opened_at = excluded.opened_at",
        rusqlite::params![work_id, name, folder, now()],
    )?;
    tx.execute(
        "DELETE FROM recent_work WHERE work_id NOT IN
           (SELECT work_id FROM recent_work ORDER BY opened_at DESC, work_id DESC LIMIT ?1)",
        [KEEP],
    )?;
    tx.commit()?;
    Ok(())
}

/// Keep the list's name for a work in step with a rename. Nothing happens when
/// the work is not in the list.
///
/// # Errors
///
/// [`crate::error::Error::Database`] when the row could not be written.
pub fn rename(conn: &Connection, work_id: &str, name: &str) -> Result<()> {
    conn.execute(
        "UPDATE recent_work SET name = ?2 WHERE work_id = ?1",
        [work_id, name],
    )?;
    Ok(())
}

/// The list, most recently opened first.
///
/// # Errors
///
/// [`crate::error::Error::Database`] when the table could not be read.
pub fn list(conn: &Connection) -> Result<Vec<Row>> {
    let mut statement = conn.prepare(
        "SELECT work_id, name, folder, opened_at FROM recent_work
         ORDER BY opened_at DESC, work_id DESC",
    )?;
    let rows = statement
        .query_map([], |row| {
            Ok(Row {
                work_id: row.get(0)?,
                name: row.get(1)?,
                folder: row.get(2)?,
                opened_at: row.get(3)?,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(rows)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{migrations, new_id};

    fn workspace() -> Connection {
        let conn = Connection::open_in_memory().expect("in-memory database");
        migrations::APP.apply(&conn).expect("migrate");
        conn
    }

    #[test]
    fn opening_a_work_again_moves_it_to_the_top_and_keeps_one_row() {
        let conn = workspace();
        let (a, b) = (new_id(), new_id());
        record(&conn, &a, "Kitchen", "C:/works/kitchen").expect("a");
        std::thread::sleep(std::time::Duration::from_millis(5));
        record(&conn, &b, "Loft", "C:/works/loft").expect("b");
        std::thread::sleep(std::time::Duration::from_millis(5));
        record(&conn, &a, "Kitchen and pantry", "D:/moved/kitchen").expect("a again");

        let rows = list(&conn).expect("list");
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].work_id, a);
        assert_eq!(rows[0].name, "Kitchen and pantry");
        assert_eq!(rows[0].folder, "D:/moved/kitchen");
        assert_eq!(rows[1].work_id, b);
    }

    #[test]
    fn a_folder_that_now_holds_another_work_forgets_the_old_one() {
        let conn = workspace();
        record(&conn, &new_id(), "Old", "C:/works/same").expect("old");
        let newer = new_id();
        record(&conn, &newer, "New", "C:/works/same").expect("new");

        let rows = list(&conn).expect("list");
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].work_id, newer);
    }

    #[test]
    fn the_list_keeps_the_most_recent_twenty() {
        let conn = workspace();
        for index in 0..(KEEP + 5) {
            record(&conn, &new_id(), "Work", &format!("C:/works/{index}")).expect("record");
        }

        assert_eq!(list(&conn).expect("list").len() as i64, KEEP);
    }
}
