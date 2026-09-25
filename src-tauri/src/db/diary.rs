//! The diary: one entry per fact about a day on site, appended, chained, and
//! never rewritten. Requirement one: no entry is ever lost.
//!
//! **This module contains no UPDATE, DELETE or REPLACE statement, by rule.**
//! The only statements it sends that write are `INSERT`s, one transaction per
//! entry. A test (`db::diary_tests`) reads this file's source and fails if a
//! line of code in it names any of those three words. The schema says the same
//! thing again with triggers (work migration 005), and no command edits or
//! removes an entry: a correction is a new entry that names the one it
//! corrects and restates the day.
//!
//! # The chain
//!
//! Every entry carries `prev_hash`, the hash of the entry before it (the empty
//! string for entry 1), and `hash`, the SHA-256 of its canonical form — which
//! includes `prev_hash` and every child row. Changing anything in an entry
//! changes its hash; recomputing that hash breaks the link from the entry
//! after it. [`verify`] recomputes every hash and every link.
//!
//! This is **tamper-evidence**: it shows whether the record was altered after
//! it was written. It is not a signature, it does not prove who wrote an entry,
//! and it is not legal proof. Whoever owns the file can rewrite it — and the
//! chain will say so. It cannot see entries removed from the *end* of the
//! diary: the last entry has no successor to point at it. (The export of slice
//! F10 records the count and the last hash, so a copy kept elsewhere can.)
//!
//! # The canonical form, version 1
//!
//! Written here once, and copied into docs/DATA_MODEL.md. It is a UTF-8 string
//! of **records** joined by U+001E (RECORD SEPARATOR); each record is a **tag**
//! followed by **fields**, joined by U+001F (UNIT SEPARATOR). A field is:
//!
//! - the empty string, for NULL;
//! - `+` followed by the value, for a value — so the empty text `''` is `+` and
//!   differs from NULL.
//!
//! Values are written as: text as stored; whole numbers in decimal (`12`);
//! real numbers as the shortest decimal that reads back as the same number,
//! with no exponent (`8`, `7.5`, `0.25` — Rust's `Display` for `f64`); the
//! boolean `lost_day` as `0` or `1`. No value may contain U+001E or U+001F:
//! the host refuses control characters in every text of an entry, and ids and
//! hashes cannot hold them.
//!
//! The records, in this order:
//!
//! 1. `entry.v1` · seq · day · kind · corrects_seq · note · weather · lost_day ·
//!    hours · deliveries · incidents · visitors · author_name · created_at ·
//!    prev_hash
//! 2. for each done line, sorted by activity id (byte order): `done` ·
//!    activity_id · state · quantity · note
//! 3. for each person present, sorted by id (byte order): `present` · person_id
//! 4. for each photo, by position: `photo` · file_hash · file_name · bytes ·
//!    width · height
//!
//! `hash` = lowercase hex of SHA-256 over the bytes of that string. A photo's
//! `thumbnail` flag is not in it: it describes the copy, not the day.
//!
//! # Changelog of this repository
//!
//! - F4: `append`, `list`, `get`, `verify`, `photo_by_hash`, `canonical`.

use std::collections::{BTreeSet, HashMap};

use rusqlite::{params, Connection, OptionalExtension, ToSql};
use sha2::{Digest, Sha256};

use crate::contract::{ChainReport, DiaryEntry, DoneLine, Photo};
use crate::db::now;
use crate::db::work::{exists, ACTIVITY_NOT_FOUND, PERSON_NOT_FOUND};
use crate::error::{Error, Result};

/// The tag the entry record starts with; the version of the canonical form.
pub const CANONICAL_TAG: &str = "entry.v1";

const RECORD: char = '\u{1E}';
const UNIT: char = '\u{1F}';

/// An entry as it is about to be written. Every field is already checked; the
/// host adds the sequence number, the moment, and the chain.
#[derive(Debug, Clone, PartialEq)]
pub struct NewEntry {
    /// `YYYY-MM-DD`, not after today.
    pub day: String,
    /// `entry` or `correction`.
    pub kind: String,
    /// The entry a correction corrects.
    pub corrects_seq: Option<i64>,
    /// What happened; none when nothing was written.
    pub note: Option<String>,
    /// One of the six words, or none.
    pub weather: Option<String>,
    /// No work was possible.
    pub lost_day: bool,
    /// Hours on site.
    pub hours: Option<f64>,
    /// What arrived.
    pub deliveries: Option<String>,
    /// What went wrong.
    pub incidents: Option<String>,
    /// Who visited.
    pub visitors: Option<String>,
    /// The account that wrote it.
    pub author_name: String,
    /// What was done, one line per activity.
    pub done: Vec<DoneLine>,
    /// Who was there, one id each.
    pub present: Vec<String>,
    /// The photos, already copied in, in order.
    pub photos: Vec<Photo>,
}

/// Write an entry at the end of the chain; returns its sequence number.
///
/// One transaction: the entry and every child row, or nothing.
///
/// # Errors
///
/// [`Error::DiaryCorrectsUnknown`] for a correction of an entry the diary does
/// not hold; [`Error::InvalidInput`] for an activity or a person not in this
/// work; [`Error::Database`] when a row cannot be written.
pub fn append(conn: &Connection, new: &NewEntry) -> Result<i64> {
    let tx = conn.unchecked_transaction()?;

    if let Some(corrected) = new.corrects_seq {
        if !exists(
            &tx,
            "SELECT 1 FROM diary_entry WHERE seq = ?1",
            &corrected.to_string(),
        )? {
            return Err(Error::DiaryCorrectsUnknown(corrected));
        }
    }
    for line in &new.done {
        if !exists(
            &tx,
            "SELECT 1 FROM activity WHERE id = ?1",
            &line.activity_id,
        )? {
            return Err(Error::InvalidInput(ACTIVITY_NOT_FOUND.into()));
        }
    }
    for person in &new.present {
        if !exists(&tx, "SELECT 1 FROM person WHERE id = ?1", person)? {
            return Err(Error::InvalidInput(PERSON_NOT_FOUND.into()));
        }
    }

    let (seq, prev_hash): (i64, String) = tx.query_row(
        "SELECT coalesce(max(seq), 0) + 1,
                coalesce((SELECT hash FROM diary_entry ORDER BY seq DESC LIMIT 1), '')
         FROM diary_entry",
        [],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;

    let mut done = new.done.clone();
    done.sort_by(|a, b| a.activity_id.cmp(&b.activity_id));
    let present: Vec<String> = new
        .present
        .iter()
        .cloned()
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();

    let mut entry = DiaryEntry {
        seq,
        day: new.day.clone(),
        kind: new.kind.clone(),
        corrects_seq: new.corrects_seq,
        note: new.note.clone(),
        weather: new.weather.clone(),
        lost_day: new.lost_day,
        hours: new.hours,
        deliveries: new.deliveries.clone(),
        incidents: new.incidents.clone(),
        visitors: new.visitors.clone(),
        author_name: new.author_name.clone(),
        created_at: now(),
        prev_hash,
        hash: String::new(),
        done,
        present,
        photos: new.photos.clone(),
    };
    entry.hash = hash_of(&entry);

    tx.execute(
        "INSERT INTO diary_entry
           (seq, day, kind, corrects_seq, note, weather, lost_day, hours, deliveries, incidents,
            visitors, author_name, created_at, prev_hash, hash)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
        params![
            entry.seq,
            entry.day,
            entry.kind,
            entry.corrects_seq,
            entry.note,
            entry.weather,
            entry.lost_day,
            entry.hours,
            entry.deliveries,
            entry.incidents,
            entry.visitors,
            entry.author_name,
            entry.created_at,
            entry.prev_hash,
            entry.hash,
        ],
    )?;
    for line in &entry.done {
        tx.execute(
            "INSERT INTO diary_done (entry_seq, activity_id, state, quantity, note)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![seq, line.activity_id, line.state, line.quantity, line.note],
        )?;
    }
    for person in &entry.present {
        tx.execute(
            "INSERT INTO diary_present (entry_seq, person_id) VALUES (?1, ?2)",
            params![seq, person],
        )?;
    }
    for (index, photo) in entry.photos.iter().enumerate() {
        tx.execute(
            "INSERT INTO diary_photo
               (entry_seq, position, file_hash, file_name, bytes, width, height, thumbnail)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                seq,
                index as i64 + 1,
                photo.file_hash,
                photo.file_name,
                photo.bytes,
                photo.width,
                photo.height,
                photo.thumbnail
            ],
        )?;
    }
    tx.commit()?;
    log::info!("diary entry #{seq} was written");
    Ok(seq)
}

/// The canonical form of an entry, exactly as the module header describes it.
pub fn canonical(entry: &DiaryEntry) -> String {
    fn text(value: &str) -> String {
        format!("+{value}")
    }
    fn maybe(value: Option<&str>) -> String {
        value.map(text).unwrap_or_default()
    }
    fn whole(value: i64) -> String {
        format!("+{value}")
    }
    fn real(value: Option<f64>) -> String {
        value.map(|v| format!("+{v}")).unwrap_or_default()
    }
    let record = |tag: &str, fields: Vec<String>| {
        let mut record = tag.to_string();
        for field in fields {
            record.push(UNIT);
            record.push_str(&field);
        }
        record
    };

    let mut records = vec![record(
        CANONICAL_TAG,
        vec![
            whole(entry.seq),
            text(&entry.day),
            text(&entry.kind),
            entry.corrects_seq.map(whole).unwrap_or_default(),
            maybe(entry.note.as_deref()),
            maybe(entry.weather.as_deref()),
            whole(i64::from(entry.lost_day)),
            real(entry.hours),
            maybe(entry.deliveries.as_deref()),
            maybe(entry.incidents.as_deref()),
            maybe(entry.visitors.as_deref()),
            text(&entry.author_name),
            text(&entry.created_at),
            text(&entry.prev_hash),
        ],
    )];
    let mut done: Vec<&DoneLine> = entry.done.iter().collect();
    done.sort_by(|a, b| a.activity_id.cmp(&b.activity_id));
    for line in done {
        records.push(record(
            "done",
            vec![
                text(&line.activity_id),
                text(&line.state),
                real(line.quantity),
                maybe(line.note.as_deref()),
            ],
        ));
    }
    let mut present: Vec<&String> = entry.present.iter().collect();
    present.sort();
    for person in present {
        records.push(record("present", vec![text(person)]));
    }
    for photo in &entry.photos {
        records.push(record(
            "photo",
            vec![
                text(&photo.file_hash),
                text(&photo.file_name),
                whole(photo.bytes),
                whole(photo.width),
                whole(photo.height),
            ],
        ));
    }
    records.join(&RECORD.to_string())
}

/// The hash of an entry: lowercase hex of SHA-256 over its canonical form.
pub fn hash_of(entry: &DiaryEntry) -> String {
    hex::encode(Sha256::digest(canonical(entry).as_bytes()))
}

/// Entries between two days (inclusive; either end may be open), newest day
/// first and, within a day, the latest written first.
///
/// # Errors
///
/// [`Error::Database`] when a table cannot be read.
pub fn list(
    conn: &Connection,
    from_day: Option<&str>,
    to_day: Option<&str>,
) -> Result<Vec<DiaryEntry>> {
    read(
        conn,
        "(?1 IS NULL OR day >= ?1) AND (?2 IS NULL OR day <= ?2)",
        &[&from_day, &to_day],
        "day DESC, seq DESC",
    )
}

/// One entry, by its sequence number.
///
/// # Errors
///
/// [`Error::Database`] when a table cannot be read.
pub fn get(conn: &Connection, seq: i64) -> Result<Option<DiaryEntry>> {
    Ok(read(conn, "seq = ?1", &[&seq], "seq")?.into_iter().next())
}

/// Recompute every hash and every link, from entry 1.
///
/// # Errors
///
/// [`Error::Database`] when a table cannot be read.
pub fn verify(conn: &Connection) -> Result<ChainReport> {
    let entries = read(conn, "1 = 1", &[], "seq ASC")?;
    let count = entries.len() as i64;
    let broken = |at: i64, problem: &'static str, reason: String| ChainReport {
        entries: count,
        intact: false,
        broken_at: Some(at),
        problem: Some(problem),
        reason: Some(reason),
    };

    let mut previous = String::new();
    for (expected, entry) in (1i64..).zip(&entries) {
        if entry.seq != expected {
            let reason = if expected == 1 {
                "Entry #1 is missing: the diary does not start at the beginning.".to_string()
            } else {
                format!(
                    "Entry #{expected} is missing: the diary goes from #{} to #{}.",
                    expected - 1,
                    entry.seq
                )
            };
            return Ok(broken(expected, "missing", reason));
        }
        if entry.prev_hash != previous {
            return Ok(broken(
                entry.seq,
                "link",
                format!(
                    "Entry #{} does not point at the entry before it: that entry was changed, or this one was.",
                    entry.seq
                ),
            ));
        }
        if hash_of(entry) != entry.hash {
            return Ok(broken(
                entry.seq,
                "contents",
                format!(
                    "Entry #{} does not match its hash: something in it was changed after it was written.",
                    entry.seq
                ),
            ));
        }
        previous = entry.hash.clone();
    }
    Ok(ChainReport {
        entries: count,
        intact: true,
        broken_at: None,
        problem: None,
        reason: None,
    })
}

/// A photo already in the work, as an earlier entry recorded it — what a
/// correction re-attaches by hash.
///
/// # Errors
///
/// [`Error::Database`] when the table cannot be read.
pub fn photo_by_hash(conn: &Connection, hash: &str) -> Result<Option<Photo>> {
    Ok(conn
        .query_row(
            "SELECT file_hash, file_name, bytes, width, height, thumbnail
             FROM diary_photo WHERE file_hash = ?1 ORDER BY entry_seq DESC LIMIT 1",
            [hash],
            photo_row,
        )
        .optional()?)
}

fn photo_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Photo> {
    Ok(Photo {
        file_hash: row.get(0)?,
        file_name: row.get(1)?,
        bytes: row.get(2)?,
        width: row.get(3)?,
        height: row.get(4)?,
        thumbnail: row.get(5)?,
    })
}

/// Entries matching `filter` (over `diary_entry`), in `order`, each with its
/// children.
fn read(
    conn: &Connection,
    filter: &str,
    bound: &[&dyn ToSql],
    order: &str,
) -> Result<Vec<DiaryEntry>> {
    let chosen = format!("SELECT seq FROM diary_entry WHERE {filter}");

    let mut done: HashMap<i64, Vec<DoneLine>> = HashMap::new();
    let rows = conn
        .prepare(&format!(
            "SELECT entry_seq, activity_id, state, quantity, note FROM diary_done
             WHERE entry_seq IN ({chosen}) ORDER BY entry_seq, activity_id"
        ))?
        .query_map(bound, |row| {
            Ok((
                row.get::<_, i64>(0)?,
                DoneLine {
                    activity_id: row.get(1)?,
                    state: row.get(2)?,
                    quantity: row.get(3)?,
                    note: row.get(4)?,
                },
            ))
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    for (seq, line) in rows {
        done.entry(seq).or_default().push(line);
    }

    let mut present: HashMap<i64, Vec<String>> = HashMap::new();
    let rows = conn
        .prepare(&format!(
            "SELECT entry_seq, person_id FROM diary_present
             WHERE entry_seq IN ({chosen}) ORDER BY entry_seq, person_id"
        ))?
        .query_map(bound, |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    for (seq, person) in rows {
        present.entry(seq).or_default().push(person);
    }

    let mut photos: HashMap<i64, Vec<Photo>> = HashMap::new();
    let rows = conn
        .prepare(&format!(
            "SELECT entry_seq, file_hash, file_name, bytes, width, height, thumbnail
             FROM diary_photo WHERE entry_seq IN ({chosen}) ORDER BY entry_seq, position"
        ))?
        .query_map(bound, |row| {
            Ok((
                row.get::<_, i64>(0)?,
                Photo {
                    file_hash: row.get(1)?,
                    file_name: row.get(2)?,
                    bytes: row.get(3)?,
                    width: row.get(4)?,
                    height: row.get(5)?,
                    thumbnail: row.get(6)?,
                },
            ))
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    for (seq, photo) in rows {
        photos.entry(seq).or_default().push(photo);
    }

    let entries = conn
        .prepare(&format!(
            "SELECT seq, day, kind, corrects_seq, note, weather, lost_day, hours, deliveries,
                    incidents, visitors, author_name, created_at, prev_hash, hash
             FROM diary_entry WHERE {filter} ORDER BY {order}"
        ))?
        .query_map(bound, |row| {
            Ok(DiaryEntry {
                seq: row.get(0)?,
                day: row.get(1)?,
                kind: row.get(2)?,
                corrects_seq: row.get(3)?,
                note: row.get(4)?,
                weather: row.get(5)?,
                lost_day: row.get(6)?,
                hours: row.get(7)?,
                deliveries: row.get(8)?,
                incidents: row.get(9)?,
                visitors: row.get(10)?,
                author_name: row.get(11)?,
                created_at: row.get(12)?,
                prev_hash: row.get(13)?,
                hash: row.get(14)?,
                done: Vec::new(),
                present: Vec::new(),
                photos: Vec::new(),
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?
        .into_iter()
        .map(|mut entry| {
            entry.done = done.remove(&entry.seq).unwrap_or_default();
            entry.present = present.remove(&entry.seq).unwrap_or_default();
            entry.photos = photos.remove(&entry.seq).unwrap_or_default();
            entry
        })
        .collect();
    Ok(entries)
}
