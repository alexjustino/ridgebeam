//! Snags (E4): what is still to fix, near the end of a work.
//!
//! A defect or a pending item found when the work is nearly done — pt
//! "pendência" — is raised on record: where it is (a stage, optionally one of
//! its activities), who must fix it (a person of the plan, or nobody), the day
//! it is due and a photo of the problem. It is closed once: `fixed`, always
//! with a photo of it fixed, or `withdrawn`, always with a note saying why — a
//! snag raised by mistake is withdrawn, never deleted. A snag found again after
//! its fix is a new snag.
//!
//! A closed stage takes a snag: snags are found after closing. Nothing here
//! refuses one for the plan's approval either — a snag is a record of the
//! site, not a plan edit.
//!
//! **This module contains no UPDATE, DELETE or REPLACE statement, by rule** —
//! the rule of the change orders' writer, for the same reason: a snag and its
//! closure are facts. A test (`db::snags_tests`) reads this file's source and
//! fails if a line of code in it names any of those three words; the schema
//! refuses them again with triggers (work migration 016).
//!
//! A photo is named by the SHA-256 of a document of the work (D3's rule): the
//! interface adds the file as a document first, through the existing intake,
//! and sends its hash. It must be an image — a PDF is never a photo of a snag.
//! The hash is written as it is; the document it names is not linked or changed
//! here. While a snag names a hash, `db::documents::named_hashes` keeps the
//! file in the folder even if its document is removed.
//!
//! Whether a snag is overdue, how long it has waited, and what it holds back
//! as retention are the domain's, computed every time; nothing computed is
//! stored.
//!
//! # Changelog of this repository
//!
//! - E4: `raise`, `close`, `list`.

use rusqlite::{params, Connection, OptionalExtension};

use crate::contract::{Snag, SnagClosure};
use crate::db::money::ACTIVITY_OF_ANOTHER_STAGE;
use crate::db::work::{exists, ACTIVITY_NOT_FOUND, PERSON_NOT_FOUND, STAGE_NOT_FOUND};
use crate::db::{new_id, now};
use crate::error::{Error, Result};
use crate::files::intake::NOT_A_PHOTO;

/// The sentence for a snag id that is not in this work.
pub const SNAG_NOT_FOUND: &str = "That snag is not in this work.";

/// The sentence for a document named as a photo that is not an image.
pub const PHOTO_NOT_AN_IMAGE: &str =
    "That document is not a photo: a snag is shown with a photo of the work.";

/// The sentence for a snag closed as fixed without a photo.
pub const FIXED_NEEDS_PHOTO: &str = "A snag is closed as fixed only with a photo of it fixed.";

/// The sentence for a snag withdrawn without a note.
pub const WITHDRAWN_NEEDS_NOTE: &str = "A snag is withdrawn with a note saying why.";

/// The sentence for a snag closed a second time.
pub fn already_closed(number: i64, outcome: &str, day: &str) -> String {
    format!("Snag #{number} was already {outcome} on {day}: a snag is closed once.")
}

/// The sentence for a closure dated before the snag was raised.
pub fn closed_before_raised(number: i64, raised_on: &str) -> String {
    format!("Snag #{number} was raised on {raised_on}: it cannot be closed before that day.")
}

/// A snag about to be raised; every field already checked on its own.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewSnag {
    /// `YYYY-MM-DD`, not after today.
    pub raised_on: String,
    /// 1 to 200 characters.
    pub title: String,
    /// Up to 2000 characters.
    pub description: Option<String>,
    /// The stage it is in.
    pub stage_id: String,
    /// An activity of that stage.
    pub activity_id: Option<String>,
    /// Who must fix it.
    pub person_id: Option<String>,
    /// `YYYY-MM-DD`, not before `raised_on`.
    pub due_on: Option<String>,
    /// A photo of the problem: the hash of an image document of the work.
    pub photo_hash: Option<String>,
    /// The account that raised it.
    pub author_name: String,
}

/// How a snag is closed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Outcome {
    /// Fixed, with a photo of it fixed.
    Fixed,
    /// Taken back — raised by mistake, or not a snag after all — with a note.
    Withdrawn,
}

impl Outcome {
    /// The word the file and the wire use.
    pub fn as_str(self) -> &'static str {
        match self {
            Outcome::Fixed => "fixed",
            Outcome::Withdrawn => "withdrawn",
        }
    }
}

/// A closure about to be recorded; every field already checked on its own.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewClosure {
    /// The snag.
    pub snag_id: String,
    /// How it is closed.
    pub outcome: Outcome,
    /// `YYYY-MM-DD`, not after today.
    pub closed_on: String,
    /// The photo of it fixed: the hash of an image document of the work.
    pub photo_hash: Option<String>,
    /// Why, up to 2000 characters.
    pub note: Option<String>,
    /// The account that closes it.
    pub author_name: String,
}

/// Refuse a hash that names no document of the work, or a document that is
/// not an image.
fn refuse_unless_image(conn: &Connection, hash: &str) -> Result<()> {
    let media_type: Option<Option<String>> = conn
        .query_row(
            "SELECT media_type FROM document WHERE file_hash = ?1",
            [hash],
            |row| row.get(0),
        )
        .optional()?;
    match media_type {
        None => Err(Error::InvalidInput(NOT_A_PHOTO.into())),
        Some(Some(media_type)) if media_type.starts_with("image/") => Ok(()),
        Some(_) => Err(Error::InvalidInput(PHOTO_NOT_AN_IMAGE.into())),
    }
}

/// Raise a snag; returns its number.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a stage, an activity or a person not in this
/// work, an activity of another stage, or a photo that is not an image
/// document of the work; [`Error::Database`] when the row cannot be written.
/// A closed stage is not refused.
pub fn raise(conn: &Connection, new: &NewSnag) -> Result<i64> {
    let tx = conn.unchecked_transaction()?;
    if !exists(&tx, "SELECT 1 FROM stage WHERE id = ?1", &new.stage_id)? {
        return Err(Error::InvalidInput(STAGE_NOT_FOUND.into()));
    }
    if let Some(activity) = &new.activity_id {
        let stage: String = tx
            .query_row(
                "SELECT stage_id FROM activity WHERE id = ?1",
                [activity],
                |row| row.get(0),
            )
            .optional()?
            .ok_or_else(|| Error::InvalidInput(ACTIVITY_NOT_FOUND.into()))?;
        if stage != new.stage_id {
            return Err(Error::InvalidInput(ACTIVITY_OF_ANOTHER_STAGE.into()));
        }
    }
    if let Some(person) = &new.person_id {
        if !exists(&tx, "SELECT 1 FROM person WHERE id = ?1", person)? {
            return Err(Error::InvalidInput(PERSON_NOT_FOUND.into()));
        }
    }
    if let Some(hash) = &new.photo_hash {
        refuse_unless_image(&tx, hash)?;
    }

    let number: i64 = tx.query_row("SELECT coalesce(max(number), 0) + 1 FROM snag", [], |row| {
        row.get(0)
    })?;
    tx.execute(
        "INSERT INTO snag
           (id, number, title, description, stage_id, activity_id, person_id, raised_on,
            due_on, photo_hash, author_name, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
        params![
            new_id(),
            number,
            new.title,
            new.description,
            new.stage_id,
            new.activity_id,
            new.person_id,
            new.raised_on,
            new.due_on,
            new.photo_hash,
            new.author_name,
            now()
        ],
    )?;
    tx.commit()?;
    log::info!("snag #{number} was raised");
    Ok(number)
}

/// Close a snag, once.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a snag not in this work, one already closed, a
/// day before it was raised, `fixed` without a photo, `withdrawn` without a
/// note, or a photo that is not an image document of the work;
/// [`Error::Database`] when the row cannot be written. Nothing is written on
/// any of them.
pub fn close(conn: &Connection, new: &NewClosure) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    let (number, raised_on): (i64, String) = tx
        .query_row(
            "SELECT number, raised_on FROM snag WHERE id = ?1",
            [&new.snag_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?
        .ok_or_else(|| Error::InvalidInput(SNAG_NOT_FOUND.into()))?;
    let closed: Option<(String, String)> = tx
        .query_row(
            "SELECT outcome, closed_on FROM snag_closure WHERE snag_id = ?1",
            [&new.snag_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    if let Some((outcome, day)) = closed {
        return Err(Error::InvalidInput(already_closed(number, &outcome, &day)));
    }
    if new.closed_on < raised_on {
        return Err(Error::InvalidInput(closed_before_raised(
            number, &raised_on,
        )));
    }
    match new.outcome {
        Outcome::Fixed if new.photo_hash.is_none() => {
            return Err(Error::InvalidInput(FIXED_NEEDS_PHOTO.into()));
        }
        Outcome::Withdrawn if new.note.is_none() => {
            return Err(Error::InvalidInput(WITHDRAWN_NEEDS_NOTE.into()));
        }
        _ => {}
    }
    if let Some(hash) = &new.photo_hash {
        refuse_unless_image(&tx, hash)?;
    }

    tx.execute(
        "INSERT INTO snag_closure
           (snag_id, outcome, closed_on, photo_hash, note, author_name, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            new.snag_id,
            new.outcome.as_str(),
            new.closed_on,
            new.photo_hash,
            new.note,
            new.author_name,
            now()
        ],
    )?;
    tx.commit()?;
    log::info!("snag #{number} was {}", new.outcome.as_str());
    Ok(())
}

/// Every snag, by number, each with its closure or `None`.
///
/// # Errors
///
/// [`Error::Database`] when a table cannot be read.
pub fn list(conn: &Connection) -> Result<Vec<Snag>> {
    let snags = conn
        .prepare(
            "SELECT s.id, s.number, s.title, s.description, s.stage_id, s.activity_id,
                    s.person_id, s.raised_on, s.due_on, s.photo_hash, s.author_name,
                    s.created_at,
                    c.outcome, c.closed_on, c.photo_hash, c.note, c.author_name, c.created_at
             FROM snag s
             LEFT JOIN snag_closure c ON c.snag_id = s.id
             ORDER BY s.number",
        )?
        .query_map([], |row| {
            let outcome: Option<String> = row.get(12)?;
            let closure = match outcome {
                None => None,
                Some(outcome) => Some(SnagClosure {
                    outcome,
                    closed_on: row.get(13)?,
                    photo_hash: row.get(14)?,
                    note: row.get(15)?,
                    author_name: row.get(16)?,
                    created_at: row.get(17)?,
                }),
            };
            Ok(Snag {
                id: row.get(0)?,
                number: row.get(1)?,
                title: row.get(2)?,
                description: row.get(3)?,
                stage_id: row.get(4)?,
                activity_id: row.get(5)?,
                person_id: row.get(6)?,
                raised_on: row.get(7)?,
                due_on: row.get(8)?,
                photo_hash: row.get(9)?,
                author_name: row.get(10)?,
                created_at: row.get(11)?,
                closure,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(snags)
}
