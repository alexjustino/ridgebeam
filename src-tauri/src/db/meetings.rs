//! Site meetings (G1): the minutes, written once when the meeting is closed.
//!
//! A weekly site meeting starts from an agenda the record already wrote — the
//! domain's, computed every time — and ends when the person closes it. Closing
//! it writes the minutes, in one transaction: the meeting (its number and
//! day), who was there, each item as the agenda said it with what was said and
//! done, the actions raised (what, on whom, by when) and the closures of the
//! earlier actions closed at it. A failure anywhere writes nothing. An action
//! may also be closed between meetings, once.
//!
//! What was done in the meeting — a decision made, a change order approved, a
//! snag raised — went through the product's own commands, and to the record as
//! always; an item's outcome only says, in words, that it happened there.
//!
//! **This module contains no UPDATE, DELETE or REPLACE statement, by rule** —
//! the rule of the snags' writer, for the same reason: minutes are facts, and
//! a mistake is said in the next meeting's minutes. A test
//! (`db::meetings_tests`) reads this file's source and fails if a line of code
//! in it names any of those three words; the schema refuses them again with
//! triggers (work migration 017), and seals each meeting's attendees, items
//! and actions to the counts written with it.
//!
//! A person — an attendee, or whom an action is on — is named by id and is not
//! a foreign key: a person removed from the plan later leaves the minutes as
//! they were. The host checks the person is in the work when the minutes are
//! written.
//!
//! Which actions are open, which are overdue and what the next agenda holds
//! are the domain's, computed every time; nothing computed is stored.
//!
//! # Changelog of this repository
//!
//! - G1: `record`, `close_action`, `list`.

use std::collections::{HashMap, HashSet};

use rusqlite::{params, Connection, OptionalExtension, Transaction};

use crate::contract::{Meeting, MeetingAction, MeetingActionClosure, MeetingAttendee, MeetingItem};
use crate::db::work::{exists, PERSON_NOT_FOUND};
use crate::db::{new_id, now};
use crate::error::{Error, Result};

/// The kinds an agenda item may be — the schema's closed list.
pub const ITEM_KINDS: [&str; 9] = [
    "action-carried",
    "decision",
    "change",
    "snag",
    "payment",
    "delay",
    "lookahead",
    "gate",
    "other",
];

/// The sentence for an action id that is not in this work.
pub const ACTION_NOT_FOUND: &str = "That action is not in this work.";

/// The sentence for an action closed a second time.
pub fn already_closed(outcome: &str, day: &str) -> String {
    format!("That action was already {outcome} on {day}: an action is closed once.")
}

/// The sentence for an action closed before the meeting that raised it.
pub fn closed_before_raised(number: i64, held_on: &str) -> String {
    format!(
        "That action was raised at meeting #{number}, on {held_on}: it cannot be closed before that day."
    )
}

/// The sentence for a person ticked twice.
pub fn attends_twice(position: usize) -> String {
    format!("A person attends a meeting once: attendee {position} is ticked twice.")
}

/// The sentence for a name written twice — whatever its case and the spaces
/// around it.
pub fn named_twice(position: usize) -> String {
    format!("A person attends a meeting once: attendee {position}'s name is already on the list.")
}

/// The sentence for an action due before its meeting.
pub fn due_before_meeting(position: usize, held_on: &str) -> String {
    format!("Action {position} is due on or after the day of the meeting, {held_on}.")
}

/// Who was there; checked on its own already — exactly one of the two.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Attendee {
    /// A person of the plan, by id.
    Person(String),
    /// Somebody named.
    Named(String),
}

/// An agenda item as it was taken; checked on its own already.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewItem {
    /// One of [`ITEM_KINDS`].
    pub kind: String,
    /// What it is about, by id.
    pub ref_id: Option<String>,
    /// As the agenda said it.
    pub title: String,
    /// What was said.
    pub note: Option<String>,
    /// What was done, in words.
    pub outcome: Option<String>,
}

/// An action raised at the meeting; checked on its own already.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewAction {
    /// What is to be done.
    pub text: String,
    /// On whom: a person, somebody named, or nobody.
    pub on: Option<Attendee>,
    /// `YYYY-MM-DD`.
    pub due_on: Option<String>,
}

/// How an action is closed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Outcome {
    /// Done.
    Done,
    /// Dropped: no longer to be done.
    Dropped,
}

impl Outcome {
    /// The word the file and the wire use.
    pub fn as_str(self) -> &'static str {
        match self {
            Outcome::Done => "done",
            Outcome::Dropped => "dropped",
        }
    }
}

/// An earlier action closed at this meeting, on its day.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CarriedClosure {
    /// The action.
    pub action_id: String,
    /// How it is closed.
    pub outcome: Outcome,
    /// A note.
    pub note: Option<String>,
}

/// The minutes about to be written; every field already checked on its own.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewMinutes {
    /// `YYYY-MM-DD`, not after today.
    pub held_on: String,
    /// What was said of the meeting as a whole.
    pub notes: Option<String>,
    /// Who was there.
    pub attendees: Vec<Attendee>,
    /// The agenda, in order.
    pub items: Vec<NewItem>,
    /// The actions raised.
    pub actions: Vec<NewAction>,
    /// The earlier actions closed at it.
    pub closures: Vec<CarriedClosure>,
    /// The account that closes the meeting.
    pub author_name: String,
}

/// An action closed between meetings; every field already checked on its own.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewActionClosure {
    /// The action.
    pub action_id: String,
    /// How it is closed.
    pub outcome: Outcome,
    /// `YYYY-MM-DD`, not after today.
    pub closed_on: String,
    /// A note.
    pub note: Option<String>,
    /// The account that closes it.
    pub author_name: String,
}

/// Refuse a person not in this work.
fn refuse_unless_person(conn: &Connection, id: &str) -> Result<()> {
    if exists(conn, "SELECT 1 FROM person WHERE id = ?1", id)? {
        Ok(())
    } else {
        Err(Error::InvalidInput(PERSON_NOT_FOUND.into()))
    }
}

/// The action's meeting (its number and day) and its closure, if any —
/// refused when the action is not in this work, or is already closed.
fn open_action(tx: &Transaction<'_>, action_id: &str) -> Result<(i64, String)> {
    let (number, held_on): (i64, String) = tx
        .query_row(
            "SELECT m.number, m.held_on FROM meeting_action a
             JOIN meeting m ON m.id = a.meeting_id WHERE a.id = ?1",
            [action_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?
        .ok_or_else(|| Error::InvalidInput(ACTION_NOT_FOUND.into()))?;
    let closed: Option<(String, String)> = tx
        .query_row(
            "SELECT outcome, closed_on FROM meeting_action_closure WHERE action_id = ?1",
            [action_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    if let Some((outcome, day)) = closed {
        return Err(Error::InvalidInput(already_closed(&outcome, &day)));
    }
    Ok((number, held_on))
}

/// Write one closure.
fn insert_closure(
    tx: &Transaction<'_>,
    action_id: &str,
    meeting_id: Option<&str>,
    closed_on: &str,
    outcome: Outcome,
    note: Option<&str>,
    author_name: &str,
) -> Result<()> {
    tx.execute(
        "INSERT INTO meeting_action_closure
           (action_id, meeting_id, closed_on, outcome, note, author_name, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            action_id,
            meeting_id,
            closed_on,
            outcome.as_str(),
            note,
            author_name,
            now()
        ],
    )?;
    Ok(())
}

/// Write the minutes of a meeting, whole; returns its number.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a person not in this work, a person ticked or
/// a name written twice, an action due before the meeting, or
/// a closure of an action not in this work or already closed;
/// [`Error::Database`] when a row cannot be written. Nothing is written on
/// any of them.
pub fn record(conn: &Connection, new: &NewMinutes) -> Result<i64> {
    let tx = conn.unchecked_transaction()?;
    let mut ticked = HashSet::new();
    let mut names = HashSet::new();
    for (index, attendee) in new.attendees.iter().enumerate() {
        match attendee {
            Attendee::Person(id) => {
                refuse_unless_person(&tx, id)?;
                if !ticked.insert(id.as_str()) {
                    return Err(Error::InvalidInput(attends_twice(index + 1)));
                }
            }
            Attendee::Named(name) => {
                if !names.insert(name.trim().to_lowercase()) {
                    return Err(Error::InvalidInput(named_twice(index + 1)));
                }
            }
        }
    }
    for (index, action) in new.actions.iter().enumerate() {
        if let Some(Attendee::Person(id)) = &action.on {
            refuse_unless_person(&tx, id)?;
        }
        if let Some(due_on) = &action.due_on {
            if *due_on < new.held_on {
                return Err(Error::InvalidInput(due_before_meeting(
                    index + 1,
                    &new.held_on,
                )));
            }
        }
    }

    let number: i64 = tx.query_row(
        "SELECT coalesce(max(number), 0) + 1 FROM meeting",
        [],
        |row| row.get(0),
    )?;
    let meeting_id = new_id();
    tx.execute(
        "INSERT INTO meeting
           (id, number, held_on, notes, attendee_count, item_count, action_count, author_name,
            created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            meeting_id,
            number,
            new.held_on,
            new.notes,
            new.attendees.len() as i64,
            new.items.len() as i64,
            new.actions.len() as i64,
            new.author_name,
            now()
        ],
    )?;
    for (index, attendee) in new.attendees.iter().enumerate() {
        let (person_id, name) = match attendee {
            Attendee::Person(id) => (Some(id.as_str()), None),
            Attendee::Named(name) => (None, Some(name.as_str())),
        };
        tx.execute(
            "INSERT INTO meeting_attendee (meeting_id, position, person_id, name)
             VALUES (?1, ?2, ?3, ?4)",
            params![meeting_id, index as i64 + 1, person_id, name],
        )?;
    }
    for (index, item) in new.items.iter().enumerate() {
        tx.execute(
            "INSERT INTO meeting_item (meeting_id, position, kind, ref_id, title, note, outcome)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                meeting_id,
                index as i64 + 1,
                item.kind,
                item.ref_id,
                item.title,
                item.note,
                item.outcome
            ],
        )?;
    }
    for (index, action) in new.actions.iter().enumerate() {
        let (person_id, name) = match &action.on {
            Some(Attendee::Person(id)) => (Some(id.as_str()), None),
            Some(Attendee::Named(name)) => (None, Some(name.as_str())),
            None => (None, None),
        };
        tx.execute(
            "INSERT INTO meeting_action
               (id, meeting_id, position, text, person_id, name, due_on, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                new_id(),
                meeting_id,
                index as i64 + 1,
                action.text,
                person_id,
                name,
                action.due_on,
                now()
            ],
        )?;
    }
    // An earlier action, closed here: open until now — a second closure of
    // the same one in these minutes finds the first — and raised at a meeting
    // held on this day or before (the meetings' days are not held in order:
    // one written down late may come before an earlier one's).
    for closure in &new.closures {
        let (raised_at, raised_on) = open_action(&tx, &closure.action_id)?;
        if new.held_on < raised_on {
            return Err(Error::InvalidInput(closed_before_raised(
                raised_at, &raised_on,
            )));
        }
        insert_closure(
            &tx,
            &closure.action_id,
            Some(&meeting_id),
            &new.held_on,
            closure.outcome,
            closure.note.as_deref(),
            &new.author_name,
        )?;
    }
    tx.commit()?;
    log::info!(
        "meeting #{number} was closed: {} attendees, {} items, {} actions, {} closed",
        new.attendees.len(),
        new.items.len(),
        new.actions.len(),
        new.closures.len()
    );
    Ok(number)
}

/// Close an action between meetings, once.
///
/// # Errors
///
/// [`Error::InvalidInput`] for an action not in this work, one already closed,
/// or a day before the meeting that raised it; [`Error::Database`] when the
/// row cannot be written. Nothing is written on any of them.
pub fn close_action(conn: &Connection, new: &NewActionClosure) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    let (raised_at, raised_on) = open_action(&tx, &new.action_id)?;
    if new.closed_on < raised_on {
        return Err(Error::InvalidInput(closed_before_raised(
            raised_at, &raised_on,
        )));
    }
    insert_closure(
        &tx,
        &new.action_id,
        None,
        &new.closed_on,
        new.outcome,
        new.note.as_deref(),
        &new.author_name,
    )?;
    tx.commit()?;
    log::info!(
        "an action of meeting #{raised_at} was {} between meetings",
        new.outcome.as_str()
    );
    Ok(())
}

/// Every meeting, by number, each with its attendees, items and actions in
/// their order — each action with its closure or `None`.
///
/// # Errors
///
/// [`Error::Database`] when a table cannot be read.
pub fn list(conn: &Connection) -> Result<Vec<Meeting>> {
    let mut attendees: HashMap<String, Vec<MeetingAttendee>> = HashMap::new();
    for row in conn
        .prepare(
            "SELECT meeting_id, position, person_id, name FROM meeting_attendee
             ORDER BY meeting_id, position",
        )?
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                MeetingAttendee {
                    position: row.get(1)?,
                    person_id: row.get(2)?,
                    name: row.get(3)?,
                },
            ))
        })?
    {
        let (meeting, attendee) = row?;
        attendees.entry(meeting).or_default().push(attendee);
    }

    let mut items: HashMap<String, Vec<MeetingItem>> = HashMap::new();
    for row in conn
        .prepare(
            "SELECT meeting_id, position, kind, ref_id, title, note, outcome FROM meeting_item
             ORDER BY meeting_id, position",
        )?
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                MeetingItem {
                    position: row.get(1)?,
                    kind: row.get(2)?,
                    ref_id: row.get(3)?,
                    title: row.get(4)?,
                    note: row.get(5)?,
                    outcome: row.get(6)?,
                },
            ))
        })?
    {
        let (meeting, item) = row?;
        items.entry(meeting).or_default().push(item);
    }

    let mut actions: HashMap<String, Vec<MeetingAction>> = HashMap::new();
    for row in conn
        .prepare(
            "SELECT a.meeting_id, a.id, a.position, a.text, a.person_id, a.name, a.due_on,
                    a.created_at,
                    c.meeting_id, c.outcome, c.closed_on, c.note, c.author_name, c.created_at
             FROM meeting_action a
             LEFT JOIN meeting_action_closure c ON c.action_id = a.id
             ORDER BY a.meeting_id, a.position",
        )?
        .query_map([], |row| {
            let outcome: Option<String> = row.get(9)?;
            let closure = match outcome {
                None => None,
                Some(outcome) => Some(MeetingActionClosure {
                    meeting_id: row.get(8)?,
                    outcome,
                    closed_on: row.get(10)?,
                    note: row.get(11)?,
                    author_name: row.get(12)?,
                    created_at: row.get(13)?,
                }),
            };
            Ok((
                row.get::<_, String>(0)?,
                MeetingAction {
                    id: row.get(1)?,
                    meeting_id: row.get(0)?,
                    position: row.get(2)?,
                    text: row.get(3)?,
                    person_id: row.get(4)?,
                    name: row.get(5)?,
                    due_on: row.get(6)?,
                    created_at: row.get(7)?,
                    closure,
                },
            ))
        })?
    {
        let (meeting, action) = row?;
        actions.entry(meeting).or_default().push(action);
    }

    let meetings = conn
        .prepare(
            "SELECT id, number, held_on, notes, author_name, created_at FROM meeting
             ORDER BY number",
        )?
        .query_map([], |row| {
            Ok(Meeting {
                id: row.get(0)?,
                number: row.get(1)?,
                held_on: row.get(2)?,
                notes: row.get(3)?,
                attendees: Vec::new(),
                items: Vec::new(),
                actions: Vec::new(),
                author_name: row.get(4)?,
                created_at: row.get(5)?,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?
        .into_iter()
        .map(|mut meeting| {
            meeting.attendees = attendees.remove(&meeting.id).unwrap_or_default();
            meeting.items = items.remove(&meeting.id).unwrap_or_default();
            meeting.actions = actions.remove(&meeting.id).unwrap_or_default();
            meeting
        })
        .collect();
    Ok(meetings)
}
