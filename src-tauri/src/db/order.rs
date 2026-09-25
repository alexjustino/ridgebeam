//! Order: stages among themselves, rooms among themselves, activities and
//! decisions within their stage.
//!
//! Order is explicit and the person edits it one step at a time — move up, move
//! down. A move at the edge is not an error: the first stage moved up is still
//! the first, and the answer is the plan as it is. After every move and every
//! removal the positions are written again as 1, 2, 3 … with no gaps, in the
//! same transaction, so the numbering the breakdown shows (1, 1.1, 1.2 …) is
//! the numbering in the file. A work written by F0, whose positions may have
//! gaps after a removal, is closed up by the first move or removal that touches
//! it.
//!
//! Positions are `UNIQUE`, and SQLite checks a unique index row by row inside
//! an `UPDATE`. Swapping two rows in place would collide halfway, so a rewrite
//! first lifts every position above the current maximum — where no new value
//! can meet an old one — and then writes 1..n.

use rusqlite::{params, Connection, OptionalExtension};

use crate::db::work::{ACTIVITY_NOT_FOUND, DECISION_NOT_FOUND, ROOM_NOT_FOUND, STAGE_NOT_FOUND};
use crate::error::{Error, Result};

/// Which way a row moves.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Direction {
    /// Towards position 1.
    Up,
    /// Away from position 1.
    Down,
}

/// A table whose rows are ordered by `position`, within a scope or globally.
///
/// The table and column names are constants of this module, never input:
/// they are spliced into SQL, and nothing a person typed ever is.
pub struct Sequence {
    table: &'static str,
    /// The column that groups the rows (`stage_id` for activities), or `None`
    /// when the table is one sequence.
    scope: Option<&'static str>,
    /// The sentence for an id that is not in this work.
    missing: &'static str,
}

/// Stages, one sequence for the work.
pub const STAGES: Sequence = Sequence {
    table: "stage",
    scope: None,
    missing: STAGE_NOT_FOUND,
};

/// Rooms, one sequence for the work.
pub const ROOMS: Sequence = Sequence {
    table: "room",
    scope: None,
    missing: ROOM_NOT_FOUND,
};

/// Activities, one sequence per stage.
pub const ACTIVITIES: Sequence = Sequence {
    table: "activity",
    scope: Some("stage_id"),
    missing: ACTIVITY_NOT_FOUND,
};

/// Decisions, one sequence per stage (F3).
pub const DECISIONS: Sequence = Sequence {
    table: "decision",
    scope: Some("stage_id"),
    missing: DECISION_NOT_FOUND,
};

impl Sequence {
    /// The scope a row belongs to — its stage, for an activity — or `None` for
    /// a table that is one sequence.
    ///
    /// # Errors
    ///
    /// [`Error::InvalidInput`] when the row is not in this work.
    pub fn scope_of(&self, conn: &Connection, id: &str) -> Result<Option<String>> {
        let column = self.scope.unwrap_or("NULL");
        let sql = format!("SELECT {column} FROM {} WHERE id = ?1", self.table);
        conn.query_row(&sql, [id], |row| row.get::<_, Option<String>>(0))
            .optional()?
            .ok_or_else(|| Error::InvalidInput(self.missing.into()))
    }

    /// The ids in a scope, in their order.
    fn members(&self, conn: &Connection, scope: Option<&str>) -> Result<Vec<String>> {
        let (sql, bound): (String, Vec<&str>) = match self.scope {
            None => (
                format!("SELECT id FROM {} ORDER BY position", self.table),
                vec![],
            ),
            Some(column) => (
                format!(
                    "SELECT id FROM {} WHERE {column} = ?1 ORDER BY position",
                    self.table
                ),
                vec![scope.unwrap_or_default()],
            ),
        };
        let mut statement = conn.prepare(&sql)?;
        let ids = statement
            .query_map(rusqlite::params_from_iter(bound), |row| row.get(0))?
            .collect::<std::result::Result<Vec<String>, _>>()?;
        Ok(ids)
    }

    /// Write the positions of a scope as 1..n in the order of `ids`.
    fn write(&self, conn: &Connection, ids: &[String]) -> Result<()> {
        if ids.is_empty() {
            return Ok(());
        }
        let table = self.table;
        let highest: i64 = conn.query_row(
            &format!("SELECT coalesce(max(position), 0) FROM {table}"),
            [],
            |row| row.get(0),
        )?;
        let lift = format!("UPDATE {table} SET position = position + ?1 WHERE id = ?2");
        let place = format!("UPDATE {table} SET position = ?1 WHERE id = ?2");
        for id in ids {
            conn.execute(&lift, params![highest, id])?;
        }
        for (index, id) in ids.iter().enumerate() {
            conn.execute(&place, params![index as i64 + 1, id])?;
        }
        Ok(())
    }

    /// Close the gaps in a scope, after a removal.
    ///
    /// # Errors
    ///
    /// [`Error::Database`] when a position cannot be written.
    pub fn close_gaps(&self, conn: &Connection, scope: Option<&str>) -> Result<()> {
        let ids = self.members(conn, scope)?;
        self.write(conn, &ids)
    }

    /// Move a row one step, and write its scope's positions as 1..n.
    ///
    /// # Errors
    ///
    /// [`Error::InvalidInput`] when the row is not in this work.
    pub fn move_one(&self, conn: &Connection, id: &str, direction: Direction) -> Result<()> {
        let tx = conn.unchecked_transaction()?;
        let scope = self.scope_of(&tx, id)?;
        let mut ids = self.members(&tx, scope.as_deref())?;
        let at = ids
            .iter()
            .position(|member| member == id)
            .ok_or_else(|| Error::InvalidInput(self.missing.into()))?;
        match direction {
            Direction::Up if at > 0 => ids.swap(at, at - 1),
            Direction::Down if at + 1 < ids.len() => ids.swap(at, at + 1),
            // The edge: nothing moves, and that is not an error.
            _ => {}
        }
        self.write(&tx, &ids)?;
        tx.commit()?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::work::tests::a_work;
    use crate::db::work::{add_activity, add_stage, remove_activity, remove_stage, snapshot};

    fn stage_order(conn: &Connection) -> Vec<(i64, String)> {
        snapshot(conn)
            .unwrap()
            .stages
            .into_iter()
            .map(|stage| (stage.position, stage.name))
            .collect()
    }

    fn three_stages(conn: &Connection) -> Vec<String> {
        ["Demolition", "Plumbing", "Tiling"]
            .iter()
            .map(|name| add_stage(conn, name).unwrap())
            .collect()
    }

    #[test]
    fn a_move_at_either_edge_changes_nothing_and_is_not_an_error() {
        let conn = a_work();
        let ids = three_stages(&conn);
        let before = stage_order(&conn);

        STAGES
            .move_one(&conn, &ids[0], Direction::Up)
            .expect("the first moved up");
        STAGES
            .move_one(&conn, &ids[2], Direction::Down)
            .expect("the last moved down");

        assert_eq!(stage_order(&conn), before);
    }

    #[test]
    fn a_stage_moved_down_then_up_swaps_with_its_neighbour_and_numbers_stay_one_to_n() {
        let conn = a_work();
        let ids = three_stages(&conn);

        STAGES.move_one(&conn, &ids[0], Direction::Down).unwrap();
        assert_eq!(
            stage_order(&conn),
            vec![
                (1, "Plumbing".into()),
                (2, "Demolition".into()),
                (3, "Tiling".into())
            ]
        );

        STAGES.move_one(&conn, &ids[2], Direction::Up).unwrap();
        assert_eq!(
            stage_order(&conn),
            vec![
                (1, "Plumbing".into()),
                (2, "Tiling".into()),
                (3, "Demolition".into())
            ]
        );
    }

    /// A work from F0 may carry gaps (a stage removed before positions were
    /// closed up). The first move writes them contiguous.
    #[test]
    fn a_move_renumbers_positions_with_gaps_contiguously() {
        let conn = a_work();
        let ids = three_stages(&conn);
        conn.execute("UPDATE stage SET position = position * 10", [])
            .expect("positions 10, 20, 30, as an older file may have them");

        STAGES.move_one(&conn, &ids[1], Direction::Up).unwrap();

        assert_eq!(
            stage_order(&conn),
            vec![
                (1, "Plumbing".into()),
                (2, "Demolition".into()),
                (3, "Tiling".into())
            ]
        );
    }

    #[test]
    fn an_activity_moves_only_within_its_stage() {
        let conn = a_work();
        let first = add_stage(&conn, "Bathroom").unwrap();
        let second = add_stage(&conn, "Kitchen").unwrap();
        let tile = add_activity(&conn, &first, "Tile").unwrap();
        let grout = add_activity(&conn, &first, "Grout").unwrap();
        let paint = add_activity(&conn, &second, "Paint").unwrap();

        ACTIVITIES.move_one(&conn, &grout, Direction::Up).unwrap();
        ACTIVITIES.move_one(&conn, &paint, Direction::Up).unwrap();

        let plan = snapshot(&conn).unwrap();
        let order: Vec<_> = plan
            .activities
            .iter()
            .map(|a| (a.stage_id.clone(), a.position, a.id.clone()))
            .collect();
        assert_eq!(
            order,
            vec![
                (first.clone(), 1, grout),
                (first, 2, tile),
                (second, 1, paint)
            ],
            "the first activity of the second stage stays where it is"
        );
    }

    #[test]
    fn a_removal_closes_the_gap_it_leaves() {
        let conn = a_work();
        let ids = three_stages(&conn);
        let tile = add_activity(&conn, &ids[2], "Tile").unwrap();
        let grout = add_activity(&conn, &ids[2], "Grout").unwrap();
        add_activity(&conn, &ids[2], "Seal").unwrap();

        remove_stage(&conn, &ids[0]).unwrap();
        remove_activity(&conn, &tile).unwrap();

        assert_eq!(
            stage_order(&conn),
            vec![(1, "Plumbing".into()), (2, "Tiling".into())]
        );
        let plan = snapshot(&conn).unwrap();
        let positions: Vec<_> = plan.activities.iter().map(|a| a.position).collect();
        assert_eq!(positions, vec![1, 2]);
        assert_eq!(plan.activities[0].id, grout);
    }

    #[test]
    fn a_move_of_something_not_in_this_work_is_a_sentence() {
        let conn = a_work();
        three_stages(&conn);
        let nobody = crate::db::new_id();

        for (sequence, sentence) in [
            (&STAGES, STAGE_NOT_FOUND),
            (&ROOMS, ROOM_NOT_FOUND),
            (&ACTIVITIES, ACTIVITY_NOT_FOUND),
        ] {
            let refused = sequence
                .move_one(&conn, &nobody, Direction::Down)
                .expect_err(sentence);
            assert_eq!(refused.kind(), "invalid_input");
            assert_eq!(refused.to_string(), sentence);
        }
    }
}
