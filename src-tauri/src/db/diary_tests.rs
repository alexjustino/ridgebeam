//! Requirement one, applied to the diary: the tests that try to rewrite it.
//!
//! These live apart from `db::diary` on purpose: that module holds no
//! statement that edits or removes a row, by rule, and the last test here reads
//! its source to prove it — so the statements that *attack* the diary cannot
//! live inside it.
//!
//! Three kinds of attack:
//!
//! - **Through SQL, with the triggers in place** — every UPDATE, DELETE,
//!   REPLACE and upsert on the four tables, with `recursive_triggers` on and
//!   off: each refused with `diary: append-only`, and the diary unchanged.
//! - **Around the chain** — an entry out of sequence, or pointing at the wrong
//!   hash, or a child row added to an entry already written: refused.
//! - **By whoever owns the file** — a second, plain connection that drops the
//!   triggers and rewrites a note, swaps a photo's hash, removes a row: not
//!   refused (nothing can refuse the owner), and `verify` then says where the
//!   chain breaks and why. That is what tamper-evidence means, and all it means.

use rusqlite::Connection;

use crate::contract::{DoneLine, Photo};
use crate::db::diary::{self, NewEntry};
use crate::db::testing::Scratch;
use crate::db::work::{add_activity, add_person, add_stage};
use crate::folder::{self, WorkState, WORK_FILE};

const REFUSAL: &str = "diary: append-only";

/// A work on disk with a stage, an activity and a person, and three entries:
/// #1 with a done line and a person, #2 with a photo row, #3 a correction of #1.
struct Fixture {
    _scratch: Scratch,
    state: WorkState,
}

impl Fixture {
    fn path(&self) -> std::path::PathBuf {
        self.state.folder.join(WORK_FILE)
    }

    fn conn(&self) -> &Connection {
        &self.state.conn
    }

    /// A second, plain connection to the same file — no pragmas, no product.
    fn outsider(&self) -> Connection {
        Connection::open(self.path()).unwrap()
    }
}

fn entry(day: &str) -> NewEntry {
    NewEntry {
        day: day.into(),
        kind: "entry".into(),
        corrects_seq: None,
        note: None,
        weather: None,
        lost_day: false,
        hours: None,
        deliveries: None,
        incidents: None,
        visitors: None,
        author_name: "Synthetic author".into(),
        done: Vec::new(),
        present: Vec::new(),
        photos: Vec::new(),
    }
}

fn photo(hash: &str) -> Photo {
    Photo {
        file_hash: hash.into(),
        file_name: "wall.jpg".into(),
        bytes: 1024,
        width: 640,
        height: 480,
        thumbnail: true,
    }
}

fn fixture() -> Fixture {
    let scratch = Scratch::create();
    let draft = serde_json::from_value(serde_json::json!({
        "name": "Synthetic diary work", "place": "", "startDate": "2026-10-05",
        "currency": "BRL", "workingDays": "1111100", "hoursPerDay": 8
    }))
    .unwrap();
    let state = folder::create(&scratch.path().join("Work"), &draft).unwrap();
    let stage = add_stage(&state.conn, "Bathroom").unwrap();
    let tiling = add_activity(&state.conn, &stage, "Tiling").unwrap();
    let ana = add_person(&state.conn, "A. Tiler").unwrap();

    diary::append(
        &state.conn,
        &NewEntry {
            note: Some("Tiles laid in the shower.".into()),
            weather: Some("sun".into()),
            hours: Some(7.5),
            done: vec![DoneLine {
                activity_id: tiling,
                state: "worked".into(),
                quantity: Some(6.0),
                note: None,
            }],
            present: vec![ana],
            ..entry("2026-10-05")
        },
    )
    .unwrap();
    diary::append(
        &state.conn,
        &NewEntry {
            note: Some("Grout delivered.".into()),
            deliveries: Some("Grout, 4 bags".into()),
            photos: vec![photo(&"a1".repeat(32)), photo(&"b2".repeat(32))],
            ..entry("2026-10-06")
        },
    )
    .unwrap();
    diary::append(
        &state.conn,
        &NewEntry {
            kind: "correction".into(),
            corrects_seq: Some(1),
            note: Some("It was six square metres, not seven.".into()),
            ..entry("2026-10-05")
        },
    )
    .unwrap();
    Fixture {
        _scratch: scratch,
        state,
    }
}

fn verify(f: &Fixture) -> (bool, Option<i64>, Option<&'static str>) {
    let report = diary::verify(f.conn()).unwrap();
    (report.intact, report.broken_at, report.problem)
}

#[test]
fn a_diary_of_three_entries_verifies_intact_and_each_points_at_the_one_before() {
    let f = fixture();
    let entries = diary::list(f.conn(), None, None).unwrap();
    let mut by_seq = entries.clone();
    by_seq.sort_by_key(|e| e.seq);

    assert_eq!(by_seq.len(), 3);
    assert_eq!(by_seq[0].prev_hash, "");
    assert_eq!(by_seq[1].prev_hash, by_seq[0].hash);
    assert_eq!(by_seq[2].prev_hash, by_seq[1].hash);
    for e in &by_seq {
        assert_eq!(diary::hash_of(e), e.hash, "#{}", e.seq);
    }
    let report = diary::verify(f.conn()).unwrap();
    assert_eq!((report.entries, report.intact), (3, true));
}

/// The canonical form, pinned: a change to it is a change to every hash in
/// every diary ever written, and must be a new version, never an edit.
#[test]
fn the_canonical_form_is_the_one_the_header_describes() {
    let f = fixture();
    let first = diary::get(f.conn(), 1).unwrap().unwrap();
    let canonical = diary::canonical(&first);

    let records: Vec<&str> = canonical.split('\u{1E}').collect();
    assert_eq!(
        records.len(),
        3,
        "the entry, one done line, one person present"
    );
    let fields: Vec<&str> = records[0].split('\u{1F}').collect();
    assert_eq!(fields[0], "entry.v1");
    assert_eq!(fields[1], "+1", "seq");
    assert_eq!(fields[2], "+2026-10-05", "day");
    assert_eq!(fields[3], "+entry", "kind");
    assert_eq!(fields[4], "", "corrects_seq is NULL");
    assert_eq!(fields[5], "+Tiles laid in the shower.");
    assert_eq!(fields[6], "+sun");
    assert_eq!(fields[7], "+0", "lost_day");
    assert_eq!(fields[8], "+7.5", "hours");
    assert_eq!(fields[9], "", "deliveries is NULL");
    assert_eq!(fields[12], "+Synthetic author");
    assert_eq!(
        fields[14], "+",
        "prev_hash is the empty text, which is not NULL"
    );
    assert_eq!(fields.len(), 15);
    assert!(records[1].starts_with("done\u{1F}+"));
    assert!(
        records[1].ends_with("\u{1F}+worked\u{1F}+6\u{1F}"),
        "{:?}",
        records[1]
    );
    assert!(records[2].starts_with("present\u{1F}+"));

    let second = diary::get(f.conn(), 2).unwrap().unwrap();
    let canonical = diary::canonical(&second);
    let photos: Vec<&str> = canonical
        .split('\u{1E}')
        .filter(|r| r.starts_with("photo"))
        .collect();
    assert_eq!(photos.len(), 2);
    assert_eq!(
        photos[0],
        format!(
            "photo\u{1F}+{}\u{1F}+wall.jpg\u{1F}+1024\u{1F}+640\u{1F}+480",
            "a1".repeat(32)
        )
    );
}

/// Every way SQL can rewrite a row, against all four tables, with
/// `recursive_triggers` on and off.
#[test]
fn every_update_delete_replace_and_upsert_on_the_diary_is_refused_whatever_the_pragmas() {
    let f = fixture();
    let before = diary::list(f.conn(), None, None).unwrap();
    let hash_1 = before.iter().find(|e| e.seq == 1).unwrap().hash.clone();
    let hash_3 = before.iter().find(|e| e.seq == 3).unwrap().hash.clone();
    let done = &before.iter().find(|e| e.seq == 1).unwrap().done[0];
    let activity = done.activity_id.clone();
    let person = before.iter().find(|e| e.seq == 1).unwrap().present[0].clone();
    let photo_hash = "a1".repeat(32);
    let new_hash = "cd".repeat(32);

    let attacks = [
        "UPDATE diary_entry SET note = 'rewritten' WHERE seq = 1".to_string(),
        "UPDATE diary_entry SET day = '2026-10-01'".to_string(),
        "UPDATE OR REPLACE diary_entry SET seq = 1 WHERE seq = 2".to_string(),
        "DELETE FROM diary_entry WHERE seq = 3".to_string(),
        "DELETE FROM diary_entry".to_string(),
        format!(
            "INSERT OR REPLACE INTO diary_entry (seq, day, kind, note, lost_day, author_name,
               created_at, prev_hash, hash)
             VALUES (1, '2026-10-05', 'entry', 'rewritten', 0, 'x', 't', '', '{new_hash}')"
        ),
        format!(
            "REPLACE INTO diary_entry (seq, day, kind, note, lost_day, author_name, created_at,
               prev_hash, hash)
             VALUES (3, '2026-10-05', 'entry', 'rewritten', 0, 'x', 't', '{hash_1}', '{new_hash}')"
        ),
        format!(
            "INSERT INTO diary_entry (seq, day, kind, note, lost_day, author_name, created_at,
               prev_hash, hash)
             VALUES (1, '2026-10-05', 'entry', 'x', 0, 'x', 't', '', '{new_hash}')
             ON CONFLICT (seq) DO UPDATE SET note = 'rewritten'"
        ),
        "UPDATE diary_done SET quantity = 60".to_string(),
        "UPDATE diary_done SET state = 'finished'".to_string(),
        "DELETE FROM diary_done".to_string(),
        format!(
            "INSERT OR REPLACE INTO diary_done (entry_seq, activity_id, state, quantity)
             VALUES (1, '{activity}', 'finished', 60)"
        ),
        format!(
            "INSERT INTO diary_done (entry_seq, activity_id, state) VALUES (1, '{activity}', 'worked')
             ON CONFLICT (entry_seq, activity_id) DO UPDATE SET state = 'finished'"
        ),
        "UPDATE diary_present SET person_id = person_id".to_string(),
        "DELETE FROM diary_present".to_string(),
        format!(
            "REPLACE INTO diary_present (entry_seq, person_id) VALUES (1, '{person}')"
        ),
        "UPDATE diary_photo SET file_name = 'other.jpg'".to_string(),
        format!("UPDATE diary_photo SET file_hash = '{new_hash}' WHERE position = 1"),
        "DELETE FROM diary_photo WHERE position = 2".to_string(),
        format!(
            "INSERT OR REPLACE INTO diary_photo
               (entry_seq, position, file_hash, file_name, bytes, width, height, thumbnail)
             VALUES (2, 1, '{photo_hash}', 'swapped.jpg', 1, 1, 1, 0)"
        ),
        // Added to an entry already written: appending, but to a record whose
        // hash was computed without it.
        format!(
            "INSERT INTO diary_done (entry_seq, activity_id, state) VALUES (2, '{activity}', 'finished')"
        ),
        format!("INSERT INTO diary_present (entry_seq, person_id) VALUES (2, '{person}')"),
        format!(
            "INSERT INTO diary_photo
               (entry_seq, position, file_hash, file_name, bytes, width, height, thumbnail)
             VALUES (1, 9, '{new_hash}', 'late.jpg', 1, 1, 1, 0)"
        ),
        // Around the chain: a gap, a fork, a wrong link, a second start.
        format!(
            "INSERT INTO diary_entry (seq, day, kind, note, lost_day, author_name, created_at,
               prev_hash, hash)
             VALUES (5, '2026-10-07', 'entry', NULL, 0, 'x', 't', '{hash_3}', '{new_hash}')"
        ),
        format!(
            "INSERT INTO diary_entry (seq, day, kind, note, lost_day, author_name, created_at,
               prev_hash, hash)
             VALUES (4, '2026-10-07', 'entry', NULL, 0, 'x', 't', '{hash_1}', '{new_hash}')"
        ),
        format!(
            "INSERT INTO diary_entry (seq, day, kind, note, lost_day, author_name, created_at,
               prev_hash, hash)
             VALUES (4, '2026-10-07', 'entry', NULL, 0, 'x', 't', '{}', '{new_hash}')",
            "0".repeat(64)
        ),
    ];

    for recursive in ["ON", "OFF"] {
        f.conn()
            .pragma_update(None, "recursive_triggers", recursive)
            .unwrap();
        for attack in &attacks {
            let refused = f
                .conn()
                .execute(attack, [])
                .expect_err(&format!("recursive_triggers {recursive}: {attack}"));
            assert!(
                refused.to_string().contains(REFUSAL),
                "recursive_triggers {recursive}: `{attack}` was refused for the wrong reason: {refused}"
            );
        }
    }

    assert_eq!(diary::list(f.conn(), None, None).unwrap(), before);
    assert!(diary::verify(f.conn()).unwrap().intact);
}

/// An entry that continues the chain properly is accepted from SQL too: the
/// triggers refuse rewriting, not writing.
#[test]
fn the_next_entry_in_sequence_pointing_at_the_last_hash_is_accepted() {
    let f = fixture();
    let last = diary::get(f.conn(), 3).unwrap().unwrap();
    f.conn()
        .execute(
            "INSERT INTO diary_entry (seq, day, kind, note, lost_day, author_name, created_at,
               prev_hash, hash)
             VALUES (4, '2026-10-07', 'entry', NULL, 0, 'x', 't', ?1, ?2)",
            [&last.hash, &"ef".repeat(32)],
        )
        .expect("seq 4, pointing at #3");
    // Accepted by the schema — and caught by the chain, because the hash was
    // made up rather than computed.
    assert_eq!(verify(&f), (false, Some(4), Some("contents")));
}

/// Why each child table carries a `BEFORE INSERT` guard: with
/// `recursive_triggers` off, a REPLACE removes the row it replaces without
/// firing a DELETE trigger. Taken away here, on this connection only, to show
/// the hole it closes; the battery above proves it is closed.
#[test]
fn without_the_insert_guard_a_replace_would_swap_a_photo_when_recursive_triggers_are_off() {
    let f = fixture();
    // Entry #4 is the latest, so a child row may still be added to it.
    diary::append(
        f.conn(),
        &NewEntry {
            photos: vec![photo(&"c3".repeat(32))],
            ..entry("2026-10-07")
        },
    )
    .unwrap();
    f.conn()
        .execute_batch("DROP TRIGGER diary_photo_no_replace;")
        .unwrap();
    f.conn()
        .pragma_update(None, "recursive_triggers", "OFF")
        .unwrap();

    f.conn()
        .execute(
            &format!(
                "INSERT OR REPLACE INTO diary_photo
                   (entry_seq, position, file_hash, file_name, bytes, width, height, thumbnail)
                 VALUES (4, 1, '{}', 'swapped.jpg', 1, 1, 1, 0)",
                "dd".repeat(32)
            ),
            [],
        )
        .expect("the hole: the photo row is replaced and no trigger saw it go");
    assert_eq!(
        verify(&f),
        (false, Some(4), Some("contents")),
        "and the chain says so"
    );
}

/// Whoever owns the file can drop the triggers. The chain cannot stop them; it
/// says where the record stops being what was written.
#[test]
fn a_note_rewritten_through_a_plain_connection_breaks_the_chain_at_that_entry() {
    let f = fixture();
    let outsider = f.outsider();
    outsider
        .execute_batch(
            "DROP TRIGGER diary_entry_no_update;
             UPDATE diary_entry SET note = 'Nothing was laid.' WHERE seq = 2;",
        )
        .unwrap();

    let report = diary::verify(f.conn()).unwrap();
    assert_eq!(
        (report.intact, report.broken_at, report.problem),
        (false, Some(2), Some("contents"))
    );
    assert_eq!(
        report.reason.as_deref(),
        Some("Entry #2 does not match its hash: something in it was changed after it was written.")
    );
}

/// The careful forger recomputes the rewritten entry's hash. The entry after
/// it still points at the old one.
#[test]
fn a_rewritten_entry_whose_hash_was_recomputed_breaks_the_link_after_it() {
    let f = fixture();
    let mut forged = diary::get(f.conn(), 2).unwrap().unwrap();
    forged.note = Some("Nothing was delivered.".into());
    let forged_hash = diary::hash_of(&forged);
    let outsider = f.outsider();
    outsider
        .execute_batch("DROP TRIGGER diary_entry_no_update;")
        .unwrap();
    outsider
        .execute(
            "UPDATE diary_entry SET note = ?1, hash = ?2 WHERE seq = 2",
            [forged.note.as_deref().unwrap(), forged_hash.as_str()],
        )
        .unwrap();

    assert_eq!(verify(&f), (false, Some(3), Some("link")));
}

#[test]
fn a_photo_hash_swapped_through_a_plain_connection_breaks_the_chain_at_its_entry() {
    let f = fixture();
    let outsider = f.outsider();
    outsider
        .execute_batch(&format!(
            "DROP TRIGGER diary_photo_no_update;
             UPDATE diary_photo SET file_hash = '{}' WHERE entry_seq = 2 AND position = 1;",
            "ee".repeat(32)
        ))
        .unwrap();

    assert_eq!(verify(&f), (false, Some(2), Some("contents")));
}

#[test]
fn an_entry_removed_through_a_plain_connection_is_missing_at_its_number() {
    let f = fixture();
    let outsider = f.outsider();
    outsider
        .execute_batch(
            "DROP TRIGGER diary_entry_no_delete;
             DROP TRIGGER diary_photo_no_delete;
             DELETE FROM diary_photo WHERE entry_seq = 2;
             DELETE FROM diary_entry WHERE seq = 2;",
        )
        .unwrap();

    let report = diary::verify(f.conn()).unwrap();
    assert_eq!(
        (report.intact, report.broken_at, report.problem),
        (false, Some(2), Some("missing"))
    );
    assert_eq!(report.entries, 2);
    assert_eq!(
        report.reason.as_deref(),
        Some("Entry #2 is missing: the diary goes from #1 to #3.")
    );
}

#[test]
fn a_done_line_removed_through_a_plain_connection_breaks_the_chain_at_its_entry() {
    let f = fixture();
    f.outsider()
        .execute_batch(
            "DROP TRIGGER diary_done_no_delete;
             DELETE FROM diary_done WHERE entry_seq = 1;",
        )
        .unwrap();

    assert_eq!(verify(&f), (false, Some(1), Some("contents")));
}

/// Stated in the module header and here: the chain cannot see the last
/// entries removed, because nothing after them points at them. The export
/// (slice F10) records the count and the last hash for exactly this reason.
#[test]
fn the_chain_cannot_see_the_last_entry_removed_and_says_so_by_its_count() {
    let f = fixture();
    f.outsider()
        .execute_batch(
            "DROP TRIGGER diary_entry_no_delete;
             DELETE FROM diary_entry WHERE seq = 3;",
        )
        .unwrap();

    let report = diary::verify(f.conn()).unwrap();
    assert!(report.intact);
    assert_eq!(
        report.entries, 2,
        "one fewer — which only a record kept elsewhere can notice"
    );
}

/// The rule in `db::diary`'s header, checked against its source: no line of
/// code in it names an UPDATE, a DELETE or a REPLACE. Comments may — the header
/// has to say what the rule is.
#[test]
fn the_module_that_writes_the_diary_holds_no_update_delete_or_replace() {
    let source = include_str!("diary.rs");
    let forbidden = ["update", "delete", "replace"];

    let offending: Vec<(usize, &str)> = source
        .lines()
        .enumerate()
        .filter(|(_, line)| !line.trim_start().starts_with("//"))
        .filter(|(_, line)| {
            line.split(|c: char| !c.is_ascii_alphanumeric())
                .any(|word| forbidden.contains(&word.to_ascii_lowercase().as_str()))
        })
        .map(|(number, line)| (number + 1, line))
        .collect();

    assert!(
        offending.is_empty(),
        "db/diary.rs must write by INSERT only: {offending:?}"
    );
    assert!(
        source.contains("INSERT INTO diary_entry"),
        "the scan is reading the right file"
    );
}
