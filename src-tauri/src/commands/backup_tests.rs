//! Backup and restore against real works on disk (F11, decision 3): a full
//! work backed up and restored into a new folder is the same work, byte for
//! byte and row for row — proven here, not claimed. Every name, note and file
//! is synthetic.

use std::collections::BTreeMap;
use std::io::Cursor;
use std::path::{Path, PathBuf};

use chrono::{DateTime, Local, NaiveDate, TimeZone};
use rusqlite::types::Value;
use rusqlite::Connection;
use serde_json::json;

use crate::commands::aftercare::{
    maintenance_add_with, maintenance_done_add_with, warranty_add_with,
};
use crate::commands::backup::*;
use crate::commands::change_orders::{change_order_decide_with, change_order_raise_with};
use crate::commands::checks::{check_answer_with, stage_start_with, AnswerDraft};
use crate::commands::decisions::decision_make_with;
use crate::commands::diary::{diary_entry_add_with, diary_list_with};
use crate::commands::documents::tests::minimal_pdf;
use crate::commands::documents::{document_add_with, documents_verify_with};
use crate::commands::funding::{
    funding_add_with, funding_receipt_add_with, funding_receipt_reverse_with,
};
use crate::commands::meetings::{meeting_action_close_with, meeting_close_with};
use crate::commands::milestones::milestone_add_with;
use crate::commands::money::{
    commitment_add_with, cost_line_add_with, payment_add_with, payment_reverse_with,
    CommitmentDraft,
};
use crate::commands::plan::{
    activity_update_with, calendar_set_with, person_add_with, person_set_stages_with,
};
use crate::commands::purchases::{purchase_add_with, purchase_event_add_with};
use crate::commands::schedule::{baseline_take_with, replan_open_with};
use crate::commands::snags::{snag_close_with, snag_raise_with};
use crate::commands::work::tests::{draft, host, host_with_a_work};
use crate::commands::work::{
    recent_works_with, work_close_with, work_create_from, work_current_with, work_get_with,
    work_open_with,
};
use crate::contract::{BaselineRowDraft, Calendar, DiaryRange, Holiday, PlanStart, WorkSnapshot};
use crate::db::testing::Scratch;
use crate::db::{self, lock, migrations, Db};
use crate::files::archive::Reader;
use crate::files::backup::{self as format, Manifest, MANIFEST, MANIFEST_HASH};
use crate::files::intake::{self, tests::jpeg, tests::png};
use crate::folder::{self, OpenWork, WORK_FILE};

const AUTHOR: &str = "A. Engineer (synthetic)";

fn today() -> NaiveDate {
    NaiveDate::from_ymd_opt(2026, 10, 9).unwrap()
}

fn now() -> DateTime<Local> {
    Local.with_ymd_and_hms(2026, 10, 9, 14, 5, 30).unwrap()
}

fn text(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn from<T: serde::de::DeserializeOwned>(value: serde_json::Value) -> T {
    serde_json::from_value(value).expect("a shape the interface could send")
}

fn folder_of(open: &OpenWork) -> PathBuf {
    lock(&open.0).as_ref().unwrap().folder.clone()
}

/// Every file under a folder, by its path inside it, with its bytes.
fn files_under(folder: &Path) -> BTreeMap<String, Vec<u8>> {
    fn walk(root: &Path, at: &Path, out: &mut BTreeMap<String, Vec<u8>>) {
        for entry in std::fs::read_dir(at).unwrap().flatten() {
            let path = entry.path();
            if path.is_dir() {
                walk(root, &path, out);
            } else {
                let name = path
                    .strip_prefix(root)
                    .unwrap()
                    .to_string_lossy()
                    .replace('\\', "/");
                out.insert(name, std::fs::read(&path).unwrap());
            }
        }
    }
    let mut out = BTreeMap::new();
    walk(folder, folder, &mut out);
    out
}

fn names_in(folder: &Path) -> Vec<String> {
    let mut names: Vec<String> = std::fs::read_dir(folder)
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    names
}

/// Every entry of an archive, by name, with its bytes.
pub fn entries_of(archive: &[u8]) -> Vec<(String, Vec<u8>)> {
    let mut reader = Reader::open(Cursor::new(archive), archive.len() as u64).expect("a ZIP");
    (0..reader.entries.len())
        .map(|index| {
            let mut bytes = Vec::new();
            reader.read(index, u64::MAX, &mut bytes).expect("read");
            (reader.entries[index].name.clone(), bytes)
        })
        .collect()
}

/// A work that holds one of everything the product records: a template's
/// plan and its provenance; stages, activities with ranges, rooms, links,
/// checks, cost lines and decisions from it; a holiday; a person with a stage;
/// a responsible; a decision made; a document library with a PDF and a
/// drawing; three diary entries — one with photos, a person present and work
/// done, and a correction re-attaching a photo; an answer with a photo, and
/// the stage it opens started; a priced line; a commitment with its quote
/// and its payment plan (D2);
/// two payments with receipts and the reversal of one; the approval (baseline
/// 1); a replanning closed by baseline 2; a second replanning left open; and a
/// change order raised and declined (E1).
pub struct FullWork {
    pub db: Db,
    pub open: OpenWork,
    pub scratch: Scratch,
    pub folder: PathBuf,
}

pub fn a_full_work() -> FullWork {
    let (db, open) = host();
    let scratch = Scratch::create();
    let folder = scratch.path().join("Bathroom");
    let plan: PlanStart = from(json!({
        "draft": {
            "rooms": [ { "key": "bath", "name": "Bathroom" }, { "key": "hall", "name": "Hall" } ],
            "stages": [
                { "key": "strip", "name": "Strip out",
                  "activities": [
                    { "key": "tiles", "name": "Remove the tiles", "durationDays": null,
                      "durationMinDays": 1, "durationMaxDays": 2, "rooms": ["bath"] },
                    { "key": "skip", "name": "Skip out", "durationDays": 1,
                      "durationMinDays": null, "durationMaxDays": null, "rooms": ["hall"] }
                  ],
                  "checks": [ { "gate": "start", "name": "Is the water off?" },
                              { "gate": "close", "name": "Is the floor clear?" } ],
                  "costLines": [ { "label": "Skip hire", "activityKey": "skip", "amountCents": 45000 },
                                 { "label": "Labour", "activityKey": null, "amountCents": null } ],
                  "decisions": [ { "name": "Which skip", "leadTimeDays": 5, "leadMinDays": 2,
                                   "leadMaxDays": 5, "needsKey": null } ] },
                { "key": "tiling", "name": "Tiling",
                  "activities": [
                    { "key": "walls", "name": "Tile the walls", "durationDays": 3,
                      "durationMinDays": 3, "durationMaxDays": 5, "rooms": [] }
                  ],
                  "checks": [], "costLines": [],
                  "decisions": [ { "name": "Which tile", "leadTimeDays": 15, "leadMinDays": null,
                                   "leadMaxDays": null, "needsKey": "walls" } ] }
            ],
            "links": [
                { "blocker": { "kind": "activity", "stageKey": "strip", "activityKey": "tiles" },
                  "blocked": { "kind": "activity", "stageKey": "strip", "activityKey": "skip" },
                  "lagDays": 1 },
                { "blocker": { "kind": "stage", "stageKey": "strip", "activityKey": null },
                  "blocked": { "kind": "stage", "stageKey": "tiling", "activityKey": null },
                  "lagDays": 0 }
            ]
        },
        "provenance": { "templateId": "bathroom-renovation", "templateVersion": 1,
                        "templateTitle": "Bathroom renovation" }
    }));
    work_create_from(
        &db,
        &open,
        &text(&folder),
        &draft("Synthetic bathroom"),
        Some(&plan),
    )
    .expect("a work from a template");

    let plan = work_get_with(&open).unwrap();
    let strip = plan.stages[0].id.clone();
    let tiling = plan.stages[1].id.clone();
    let remove_tiles = plan.activities[0].id.clone();
    let walls = plan.activities[2].id.clone();

    calendar_set_with(
        &open,
        &Calendar {
            working_days: "1111100".into(),
            hours_per_day: 8.0,
        },
        &[Holiday {
            date: "2026-11-02".into(),
            name: "Synthetic holiday".into(),
        }],
    )
    .unwrap();
    let person = person_add_with(&open, "Ana (synthetic)").unwrap().people[0]
        .id
        .clone();
    person_set_stages_with(&open, &person, std::slice::from_ref(&strip)).unwrap();
    activity_update_with(
        &open,
        &remove_tiles,
        &from(json!({ "durationDays": 2, "responsibleId": person })),
    )
    .unwrap();
    let decision = work_get_with(&open).unwrap().decisions[0].id.clone();
    decision_make_with(&open, &decision, Some("The small one")).unwrap();
    cost_line_add_with(&open, &tiling, Some(&walls), "Tiles", Some(120_000.0)).unwrap();

    let source = Scratch::create();
    let put = |name: &str, bytes: Vec<u8>| -> String {
        let path = source.path().join(name);
        std::fs::write(&path, bytes).unwrap();
        text(&path)
    };
    let permit = put("permit.pdf", minimal_pdf());
    let drawing = put("drawing.png", png(80, 60));
    let wall = put("wall.jpg", jpeg(64, 48));
    let floor = put("floor.png", png(40, 30));
    let inspection = put("water-off.jpg", jpeg(32, 24));
    let quote = put("quote.png", png(30, 40));
    let receipt = put("receipt.pdf", {
        let mut pdf = minimal_pdf();
        pdf.extend_from_slice(b"% the receipt\n");
        pdf
    });
    let second_receipt = put("receipt-2.png", png(20, 20));

    document_add_with(&open, &[permit, drawing], "permit", None, today(), AUTHOR).unwrap();

    diary_entry_add_with(
        &open,
        &from(json!({
            "day": "2026-10-05", "kind": "entry", "weather": "rain", "note": "Water off.",
            "present": [person], "done": [{ "activityId": remove_tiles, "state": "worked" }],
            "photoPaths": [wall, floor]
        })),
        today(),
        AUTHOR,
    )
    .unwrap();
    diary_entry_add_with(
        &open,
        &from(json!({ "day": "2026-10-06", "kind": "entry", "note": "Tiles out." })),
        today(),
        AUTHOR,
    )
    .unwrap();
    let wall_hash = intake::sha256_hex(&jpeg(64, 48));
    diary_entry_add_with(
        &open,
        &from(json!({
            "day": "2026-10-05", "kind": "correction", "correctsSeq": 1,
            "note": "It was the hall wall.", "photoHashes": [wall_hash]
        })),
        today(),
        AUTHOR,
    )
    .unwrap();

    let start_check = work_get_with(&open)
        .unwrap()
        .checks
        .iter()
        .find(|c| c.name == "Is the water off?")
        .unwrap()
        .id
        .clone();
    check_answer_with(
        &open,
        &AnswerDraft {
            check_id: &start_check,
            answer: "yes",
            reason: Some("Checked at the meter."),
            photo_path: Some(&inspection),
            photo_hash: None,
        },
        AUTHOR,
    )
    .unwrap();
    stage_start_with(&open, &strip).unwrap();

    let commitment = commitment_add_with(
        &open,
        &strip,
        &CommitmentDraft {
            person_id: Some(&person),
            label: "Strip-out quote",
            amount_cents: 200_000.0,
            agreed_on: "2026-10-01",
            document_path: Some(&quote),
            document_hash: None,
        },
    )
    .unwrap()
    .commitments[0]
        .id
        .clone();
    milestone_add_with(
        &open,
        &commitment,
        "Half up front",
        5_000.0,
        "advance",
        None,
    )
    .unwrap();
    // E4: the last part held back as retention.
    milestone_add_with(&open, &commitment, "Retention", 500.0, "retention", None).unwrap();
    payment_add_with(
        &open,
        &from(json!({
            "day": "2026-10-06", "stageId": strip, "personId": person,
            "commitmentId": commitment, "amountCents": 100000, "whatFor": "Half up front",
            "receiptPath": receipt
        })),
        today(),
        AUTHOR,
    )
    .unwrap();
    payment_add_with(
        &open,
        &from(json!({
            "day": "2026-10-07", "stageId": strip, "amountCents": 5000,
            "whatFor": "Paid twice", "receiptPath": second_receipt
        })),
        today(),
        AUTHOR,
    )
    .unwrap();
    payment_reverse_with(&open, 2, "Paid twice by mistake", today(), AUTHOR).unwrap();
    let bath = work_get_with(&open).unwrap().rooms[0].id.clone();
    crate::commands::care_notes::care_note_add_with(
        &open,
        "room",
        &bath,
        "Reseal the shower grout once a year",
    )
    .unwrap();

    let take = |open: &OpenWork| -> WorkSnapshot {
        let rows: Vec<BaselineRowDraft> = work_get_with(open)
            .unwrap()
            .activities
            .iter()
            .map(|a| from(json!({ "activityId": a.id })))
            .collect();
        baseline_take_with(open, &rows, None).unwrap()
    };
    take(&open);
    replan_open_with(&open, "The skip came late", AUTHOR).unwrap();
    take(&open);
    replan_open_with(&open, "The tiles are back-ordered", AUTHOR).unwrap();
    // E1: a change order, raised and declined — the plan stays as it is.
    let change = change_order_raise_with(
        &open,
        &from(json!({
            "raisedOn": "2026-10-08", "title": "Heated floor", "askedBy": "other",
            "askedByName": "The neighbour", "stageId": strip, "costCents": 250000
        })),
        today(),
        AUTHOR,
    )
    .unwrap()
    .change_orders[0]
        .id
        .clone();
    change_order_decide_with(
        &open,
        &from(json!({
            "id": change, "outcome": "declined", "decidedOn": "2026-10-09",
            "note": "Not in this budget."
        })),
        today(),
        AUTHOR,
    )
    .unwrap();
    // E2: a fund, received, the receipt reversed and received again.
    let savings = funding_add_with(
        &open,
        &from(json!({
            "label": "Savings", "source": "Our account", "amountCents": 400000,
            "expectedOn": "2026-10-01", "note": "On hand."
        })),
    )
    .unwrap()
    .funding[0]
        .id
        .clone();
    for day in ["2026-10-02", "2026-10-03"] {
        funding_receipt_add_with(
            &open,
            &from(json!({ "fundingId": savings, "amountCents": 400000, "day": day })),
            today(),
            AUTHOR,
        )
        .unwrap();
    }
    funding_receipt_reverse_with(&open, 2, "2026-10-03", today(), AUTHOR).unwrap();
    // E4: two snags on the strip-out — one fixed with its photo, one open.
    let fixed_photo = intake::sha256_hex(&jpeg(32, 24));
    let snag = snag_raise_with(
        &open,
        &from(json!({
            "raisedOn": "2026-10-07", "title": "Wall plug left behind", "stageId": strip,
            "activityId": remove_tiles, "personId": person, "dueOn": "2026-10-09",
            "photoHash": wall_hash, "description": "By the hall door."
        })),
        today(),
        AUTHOR,
    )
    .unwrap()
    .snags[0]
        .id
        .clone();
    snag_close_with(
        &open,
        &from(json!({
            "snagId": snag, "outcome": "fixed", "closedOn": "2026-10-08",
            "photoHash": fixed_photo, "note": "Filled and sanded."
        })),
        today(),
        AUTHOR,
    )
    .unwrap();
    snag_raise_with(
        &open,
        &from(json!({
            "raisedOn": "2026-10-08", "title": "Skirting chipped", "stageId": tiling,
            "personId": person
        })),
        today(),
        AUTHOR,
    )
    .unwrap();
    // G1: a meeting's minutes — two attendees, an item, two actions; one
    // action closed between meetings, one open.
    let minutes = meeting_close_with(
        &open,
        &from(json!({
            "heldOn": "2026-10-08", "notes": "On site, after the skip.",
            "attendees": [ { "personId": person }, { "name": "The neighbour" } ],
            "items": [ { "kind": "snag", "refId": snag, "title": "Wall plug left behind",
                         "note": "Filled already.", "outcome": "Fixed" } ],
            "actions": [
                { "text": "Order the skirting", "personId": person, "dueOn": "2026-10-09" },
                { "text": "Move the car", "name": "The neighbour" }
            ]
        })),
        today(),
        AUTHOR,
    )
    .unwrap();
    meeting_action_close_with(
        &open,
        &from(json!({
            "actionId": minutes.meetings[0].actions[0].id, "outcome": "done",
            "closedOn": "2026-10-09", "note": "Ordered."
        })),
        today(),
        AUTHOR,
    )
    .unwrap();
    // G2: two purchases — the tiles ordered and delivered, the skirting to
    // order, for removing the old tiles.
    let tiles = purchase_add_with(
        &open,
        &from(json!({
            "stageId": tiling, "name": "Wall tiles", "quantity": "12 m²",
            "supplier": "The tile shop", "leadDays": 14, "note": "White, matt."
        })),
    )
    .unwrap()
    .purchases[0]
        .id
        .clone();
    for (kind, day) in [("ordered", "2026-10-02"), ("delivered", "2026-10-08")] {
        purchase_event_add_with(
            &open,
            &from(json!({ "purchaseId": tiles, "kind": kind, "day": day, "note": "On time." })),
            today(),
            AUTHOR,
        )
        .unwrap();
    }
    purchase_add_with(
        &open,
        &from(
            json!({ "stageId": strip, "activityId": remove_tiles, "name": "Skirting",
                      "leadDays": 5 }),
        ),
    )
    .unwrap();
    // G4: a warranty on the tiling stage, and a task on the work, done once.
    let work_id = warranty_add_with(
        &open,
        &from(json!({
            "targetKind": "stage", "targetId": tiling, "title": "Shower valve",
            "givenBy": "The plumber", "startsOn": "2026-10-08", "months": 24
        })),
    )
    .unwrap()
    .work
    .work_id;
    let reseal = maintenance_add_with(
        &open,
        &from(json!({
            "targetKind": "work", "targetId": work_id, "title": "Reseal the shower",
            "everyMonths": 12, "firstDueOn": "2027-10-08", "note": "Silicone, white."
        })),
    )
    .unwrap()
    .maintenance[0]
        .id
        .clone();
    maintenance_done_add_with(
        &open,
        &from(json!({ "taskId": reseal, "doneOn": "2026-10-09", "note": "Done early." })),
        today(),
        AUTHOR,
    )
    .unwrap();

    let plan = work_get_with(&open).unwrap();
    assert_eq!(plan.warranties.len(), 1);
    assert_eq!(plan.maintenance[0].done.len(), 1, "a task done once");
    assert_eq!(
        plan.purchases
            .iter()
            .map(|p| p.events.len())
            .collect::<Vec<_>>(),
        vec![2, 0],
        "one delivered, one to order"
    );
    assert_eq!(
        plan.funding_receipts.len(),
        3,
        "two receipts and a reversal"
    );
    assert_eq!(plan.baselines.len(), 2);
    assert!(plan.replanning.is_some(), "a replanning is open");
    assert_eq!(plan.payments.len(), 3, "two payments and a reversal");
    assert_eq!(plan.documents.len(), 8);
    assert_eq!(plan.snags.len(), 2, "one fixed, one open");
    assert_eq!(plan.meetings[0].actions.len(), 2, "one closed, one open");
    FullWork {
        db,
        open,
        scratch,
        folder,
    }
}

/// Every user table, with its columns (from `PRAGMA table_info`) and its rows
/// in the order of every column — so a new table or a new column is compared
/// without anybody remembering to add it here.
fn every_table(conn: &Connection) -> BTreeMap<String, (Vec<String>, Vec<Vec<Value>>)> {
    let mut tables = BTreeMap::new();
    let names: Vec<String> = conn
        .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
             ORDER BY name",
        )
        .unwrap()
        .query_map([], |row| row.get(0))
        .unwrap()
        .collect::<std::result::Result<_, _>>()
        .unwrap();
    for name in names {
        let columns: Vec<String> = conn
            .prepare(&format!("PRAGMA table_info(\"{name}\")"))
            .unwrap()
            .query_map([], |row| row.get::<_, String>(1))
            .unwrap()
            .collect::<std::result::Result<_, _>>()
            .unwrap();
        assert!(!columns.is_empty(), "{name} has columns");
        let list = columns
            .iter()
            .map(|c| format!("\"{c}\""))
            .collect::<Vec<_>>()
            .join(", ");
        let order = (1..=columns.len())
            .map(|i| i.to_string())
            .collect::<Vec<_>>()
            .join(", ");
        let mut statement = conn
            .prepare(&format!("SELECT {list} FROM \"{name}\" ORDER BY {order}"))
            .unwrap();
        let rows: Vec<Vec<Value>> = statement
            .query_map([], |row| {
                (0..columns.len())
                    .map(|i| row.get::<_, Value>(i))
                    .collect::<std::result::Result<Vec<_>, _>>()
            })
            .unwrap()
            .collect::<std::result::Result<_, _>>()
            .unwrap();
        tables.insert(name, (columns, rows));
    }
    tables
}

/// The schema itself: every table, index and trigger, as written.
fn schema_of(conn: &Connection) -> Vec<(String, String, Option<String>)> {
    conn.prepare("SELECT type, name, sql FROM sqlite_master ORDER BY type, name")
        .unwrap()
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
        .unwrap()
        .collect::<std::result::Result<_, _>>()
        .unwrap()
}

fn read_only(path: &Path) -> Connection {
    Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap()
}

/// Decision 3, in full. A full work → a backup → a restore into a new folder:
/// the restored `work.sqlite3` is the archive's snapshot byte for byte, open
/// and closed; every document and thumbnail is the original's byte for byte;
/// every table's rows equal the original's, compared column by column; the
/// schema is the same; the chain verifies and the documents are as recorded.
#[test]
fn a_full_work_backed_up_and_restored_is_the_same_work_byte_for_byte_and_row_for_row() {
    let work = a_full_work();
    let (db, open) = (&work.db, &work.open);
    let original_id = work_current_with(open).unwrap().unwrap().work_id;

    // A live database: the last writes are still in the write-ahead log.
    let wal = work.folder.join(format!("{WORK_FILE}-wal"));
    assert!(
        std::fs::metadata(&wal).map(|m| m.len()).unwrap_or(0) > 0,
        "the log holds writes not yet folded in"
    );
    let entries_before = diary_list_with(open, &DiaryRange::default()).unwrap();

    let backups = Scratch::create();
    let archive_path = backups.path().join("Bathroom.ridgebeam");
    let written = backup_write_with(db, open, &text(&archive_path), false, now()).unwrap();
    assert_eq!(written.path, text(&archive_path));
    assert_eq!(
        names_in(backups.path()),
        vec!["Bathroom.ridgebeam"],
        "no temporary file is left beside it"
    );
    let archive = std::fs::read(&archive_path).unwrap();
    assert_eq!(written.bytes, archive.len() as u64);
    assert!(written.left_out.is_empty());

    // What the archive holds, in its order.
    let entries = entries_of(&archive);
    let names: Vec<&str> = entries.iter().map(|(n, _)| n.as_str()).collect();
    assert_eq!(names[0], MANIFEST);
    assert_eq!(names[1], WORK_FILE);
    assert_eq!(*names.last().unwrap(), MANIFEST_HASH);
    let manifest: Manifest = serde_json::from_slice(&entries[0].1).unwrap();
    assert_eq!(manifest.files.len(), written.files);
    assert_eq!(manifest.work_id, original_id);
    assert_eq!(manifest.work_name, "Synthetic bathroom");
    assert_eq!(manifest.schema_version, migrations::WORK.target_version());
    assert_eq!(
        manifest.created_at,
        now()
            .with_timezone(&chrono::Utc)
            .format("%Y-%m-%dT%H:%M:%S%.3fZ")
            .to_string()
    );
    let snapshot = entries[1].1.clone();
    assert_eq!(&snapshot[..16], b"SQLite format 3\0");
    assert_eq!(
        (snapshot[18], snapshot[19]),
        (2, 2),
        "the snapshot is in WAL mode, as a closed work is"
    );

    work_close_with(open);
    let original_before_restore = files_under(&work.folder);

    // The recent list knows the work at its first folder; the restore moves it.
    let restored_folder = work.scratch.path().join("Bathroom, restored");
    let restored = backup_restore_with(db, open, &text(&archive_path), &text(&restored_folder))
        .expect("restored");

    assert_eq!(restored.work_id, original_id);
    assert_eq!(restored.folder, text(&restored_folder));
    assert_eq!(restored.entries, 3);
    assert!(restored.chain_ok);
    assert_eq!(restored.documents, 8);
    assert!(restored.mismatched.is_empty() && restored.missing.is_empty());
    assert_eq!(restored.moved_recent_from, Some(text(&work.folder)));
    let wire = serde_json::to_value(&restored).unwrap();
    for key in [
        "workId",
        "folder",
        "entries",
        "chainOk",
        "documents",
        "mismatched",
        "missing",
        "movedRecentFrom",
    ] {
        assert!(wire.get(key).is_some(), "`{key}` is on the wire");
    }

    // The work is open, from its new folder.
    let current = work_current_with(open).unwrap().unwrap();
    assert_eq!(
        (current.work_id.as_str(), current.folder.as_str()),
        (original_id.as_str(), text(&restored_folder).as_str())
    );
    let report = documents_verify_with(open).unwrap();
    assert!(report.orphans.is_empty() && report.mismatched.is_empty());
    assert_eq!(
        diary_list_with(open, &DiaryRange::default()).unwrap(),
        entries_before
    );

    // Byte for byte: the database is the archive's snapshot, open and closed.
    let restored_db = restored_folder.join(WORK_FILE);
    assert!(
        std::fs::read(&restored_db).unwrap() == snapshot,
        "open, the restored database is the archive's snapshot byte for byte"
    );
    work_close_with(open);
    assert!(
        std::fs::read(&restored_db).unwrap() == snapshot,
        "closed, it still is"
    );

    // Byte for byte: every document and thumbnail is the original's.
    let original_files = files_under(&work.folder);
    assert_eq!(
        files_under(&work.folder),
        original_before_restore,
        "the original folder was left as it was"
    );
    let restored_files = files_under(&restored_folder);
    let files = |all: &BTreeMap<String, Vec<u8>>| -> BTreeMap<String, Vec<u8>> {
        all.iter()
            .filter(|(name, _)| name.starts_with("documents/") || name.starts_with("thumbnails/"))
            .map(|(n, b)| (n.clone(), b.clone()))
            .collect()
    };
    assert_eq!(
        files(&original_files).len(),
        14,
        "8 documents, and a thumbnail for each of the 6 images"
    );
    assert!(
        files(&original_files) == files(&restored_files),
        "every document and thumbnail, byte for byte"
    );
    assert_eq!(
        restored_files.keys().collect::<Vec<_>>(),
        original_files.keys().collect::<Vec<_>>(),
        "and nothing else: one database, no log beside it"
    );

    // Row for row: every table, every column, as `PRAGMA table_info` names
    // them.
    let original = read_only(&work.folder.join(WORK_FILE));
    let copy = read_only(&restored_db);
    assert_eq!(schema_of(&copy), schema_of(&original), "the same schema");
    let (before, after) = (every_table(&original), every_table(&copy));
    assert_eq!(
        after.keys().collect::<Vec<_>>(),
        before.keys().collect::<Vec<_>>()
    );
    for (table, (columns, rows)) in &before {
        let (copy_columns, copy_rows) = &after[table];
        assert_eq!(copy_columns, columns, "{table}: the same columns");
        assert!(copy_rows == rows, "{table}: the same rows");
    }
    // The fixture holds a row in every table, so no table is compared empty
    // against empty.
    let empty: Vec<&String> = before
        .iter()
        .filter(|(_, (_, rows))| rows.is_empty())
        .map(|(name, _)| name)
        .collect();
    assert!(
        empty.is_empty(),
        "tables the fixture leaves empty: {empty:?}"
    );
    assert!(before.len() >= 25, "{} tables", before.len());
}

#[test]
fn the_manifest_says_what_the_archive_holds_and_its_hash_is_beside_it() {
    let work = a_full_work();
    let backups = Scratch::create();
    let path = backups.path().join("b.ridgebeam");
    backup_write_with(&work.db, &work.open, &text(&path), false, now()).unwrap();
    let entries = entries_of(&std::fs::read(&path).unwrap());
    let manifest_text = String::from_utf8(entries[0].1.clone()).unwrap();

    let value: serde_json::Value = serde_json::from_str(&manifest_text).unwrap();
    assert_eq!(value.as_object().unwrap().len(), 7);
    let at: Vec<usize> = [
        "ridgebeamBackup",
        "createdAt",
        "app",
        "workId",
        "workName",
        "schemaVersion",
        "files",
    ]
    .iter()
    .map(|key| manifest_text.find(&format!("\n  \"{key}\": ")).expect(key))
    .collect();
    assert!(
        at.windows(2).all(|w| w[0] < w[1]),
        "written in this order: {at:?}"
    );
    assert!(manifest_text.starts_with("{\n  \"ridgebeamBackup\": 1,\n"));
    assert_eq!(value["ridgebeamBackup"], 1);
    assert_eq!(
        value["app"],
        format!("Ridgebeam {}", env!("CARGO_PKG_VERSION"))
    );
    assert!(manifest_text.ends_with("}\n"));
    for (file, (name, bytes)) in value["files"]
        .as_array()
        .unwrap()
        .iter()
        .zip(&entries[1..entries.len() - 1])
    {
        assert_eq!(file["path"], name.as_str());
        assert_eq!(file["bytes"], bytes.len());
        assert_eq!(file["sha256"], intake::sha256_hex(bytes));
    }
    assert_eq!(
        String::from_utf8(entries.last().unwrap().1.clone()).unwrap(),
        format!(
            "{}  manifest.json\n",
            intake::sha256_hex(manifest_text.as_bytes())
        ),
        "the form sha256sum -c reads"
    );
    work_close_with(&work.open);
}

/// Windows' own `tar.exe` (libarchive) is a second reader of what the host
/// writes, of another lineage: it lists the same names and extracts the same
/// bytes.
#[cfg(windows)]
#[test]
fn windows_own_tar_reads_a_backup_as_the_host_wrote_it() {
    let work = a_full_work();
    let backups = Scratch::create();
    let path = backups.path().join("second-reader.ridgebeam");
    backup_write_with(&work.db, &work.open, &text(&path), false, now()).unwrap();
    work_close_with(&work.open);
    let tar = std::env::var_os("SystemRoot")
        .map(|root| PathBuf::from(root).join("System32").join("tar.exe"))
        .filter(|tar| tar.is_file())
        .expect("tar.exe ships with Windows 10 1803 and later");
    let entries = entries_of(&std::fs::read(&path).unwrap());

    let listed = std::process::Command::new(&tar)
        .arg("-tf")
        .arg(&path)
        .output()
        .unwrap();
    assert!(listed.status.success(), "{listed:?}");
    let listed: Vec<String> = String::from_utf8(listed.stdout)
        .unwrap()
        .lines()
        .map(str::to_string)
        .collect();
    assert_eq!(
        listed,
        entries.iter().map(|(n, _)| n.clone()).collect::<Vec<_>>()
    );

    let out = Scratch::create();
    let extracted = std::process::Command::new(&tar)
        .arg("-xf")
        .arg(&path)
        .arg("-C")
        .arg(out.path())
        .output()
        .unwrap();
    assert!(extracted.status.success(), "{extracted:?}");
    let found = files_under(out.path());
    assert_eq!(found.len(), entries.len());
    for (name, bytes) in &entries {
        assert!(&found[name] == bytes, "{name}: the same bytes");
    }
}

#[test]
fn a_work_with_no_documents_is_a_manifest_a_database_and_a_hash() {
    let (db, open, scratch) = host_with_a_work();
    let backups = Scratch::create();
    let path = backups.path().join("empty.ridgebeam");

    let written = backup_write_with(&db, &open, &text(&path), false, now()).unwrap();

    assert_eq!(written.files, 1);
    let names: Vec<String> = entries_of(&std::fs::read(&path).unwrap())
        .into_iter()
        .map(|(n, _)| n)
        .collect();
    assert_eq!(names, vec![MANIFEST, WORK_FILE, MANIFEST_HASH]);
    work_close_with(&open);

    let target = scratch.path().join("Restored");
    let restored = backup_restore_with(&db, &open, &text(&path), &text(&target)).unwrap();
    assert_eq!((restored.entries, restored.documents), (0, 0));
    assert!(restored.chain_ok);
    work_close_with(&open);
    assert_eq!(names_in(&target), vec![WORK_FILE]);
}

/// The replanning that is open travels: a restored work is still being
/// replanned, with the same reason, and its plan is not locked.
#[test]
fn a_backup_taken_while_a_replanning_is_open_restores_it_open() {
    let work = a_full_work();
    let before = work_get_with(&work.open).unwrap().replanning.unwrap();
    let backups = Scratch::create();
    let path = backups.path().join("replanning.ridgebeam");
    backup_write_with(&work.db, &work.open, &text(&path), false, now()).unwrap();
    work_close_with(&work.open);

    let target = work.scratch.path().join("Replanning");
    backup_restore_with(&work.db, &work.open, &text(&path), &text(&target)).unwrap();

    let plan = work_get_with(&work.open).unwrap();
    assert_eq!(plan.replanning, Some(before));
    assert_eq!(
        plan.replanning.unwrap().reason,
        "The tiles are back-ordered"
    );
    work_close_with(&work.open);
}

#[test]
fn a_restore_into_a_folder_that_holds_anything_is_refused_and_writes_nothing() {
    let (db, open, scratch) = host_with_a_work();
    let backups = Scratch::create();
    let path = backups.path().join("b.ridgebeam");
    backup_write_with(&db, &open, &text(&path), false, now()).unwrap();
    work_close_with(&open);

    let busy = scratch.path().join("Busy");
    std::fs::create_dir(&busy).unwrap();
    std::fs::write(busy.join("notes.txt"), "somebody's file").unwrap();
    let around = names_in(scratch.path());

    let refused = backup_restore_with(&db, &open, &text(&path), &text(&busy)).unwrap_err();

    assert_eq!(refused.kind(), "work_folder_not_empty");
    assert_eq!(names_in(&busy), vec!["notes.txt"]);
    assert_eq!(names_in(scratch.path()), around, "nothing beside it either");
    assert_eq!(work_current_with(&open).unwrap(), None);

    let file = scratch.path().join("a file");
    std::fs::write(&file, "x").unwrap();
    assert_eq!(
        backup_restore_with(&db, &open, &text(&path), &text(&file))
            .unwrap_err()
            .to_string(),
        "That path is a file, not a folder."
    );
    assert_eq!(
        backup_restore_with(&db, &open, &text(&path), "relative/folder")
            .unwrap_err()
            .kind(),
        "invalid_input"
    );
    assert_eq!(
        backup_restore_with(
            &db,
            &open,
            &text(&path),
            &text(&scratch.path().join("missing").join("Restored"))
        )
        .unwrap_err()
        .to_string(),
        format::NO_PARENT
    );
}

/// An empty folder the person made for it is a fine place to restore to.
#[test]
fn a_restore_into_an_empty_folder_that_already_exists_fills_it() {
    let (db, open, scratch) = host_with_a_work();
    let backups = Scratch::create();
    let path = backups.path().join("b.ridgebeam");
    backup_write_with(&db, &open, &text(&path), false, now()).unwrap();
    work_close_with(&open);
    let target = scratch.path().join("Empty");
    std::fs::create_dir(&target).unwrap();

    backup_restore_with(&db, &open, &text(&path), &text(&target)).unwrap();

    assert!(target.join(WORK_FILE).is_file());
    assert_eq!(folder_of(&open), target);
    work_close_with(&open);
    assert_eq!(names_in(&target), vec![WORK_FILE]);
}

/// The recent list moves the work's row to the restored folder and says where
/// it was; the old folder is left exactly as it was. A work the list does not
/// know moves nothing.
#[test]
fn restoring_a_work_the_recent_list_knows_elsewhere_moves_its_row_and_leaves_the_old_folder() {
    let (db, open, scratch) = host_with_a_work();
    let first = work_current_with(&open).unwrap().unwrap();
    let backups = Scratch::create();
    let path = backups.path().join("b.ridgebeam");
    backup_write_with(&db, &open, &text(&path), false, now()).unwrap();
    work_close_with(&open);
    let old_files = files_under(Path::new(&first.folder));

    let summary = backup_inspect_with(&db, &text(&path)).unwrap();
    assert_eq!(summary.recent_folder, Some(first.folder.clone()));

    let target = scratch.path().join("Elsewhere");
    let restored = backup_restore_with(&db, &open, &text(&path), &text(&target)).unwrap();

    assert_eq!(restored.moved_recent_from, Some(first.folder.clone()));
    let recent = recent_works_with(&db).unwrap();
    assert_eq!(recent.len(), 1, "one row for the work");
    assert_eq!(recent[0].folder, text(&target));
    assert_eq!(
        files_under(Path::new(&first.folder)),
        old_files,
        "the old folder was left as it was"
    );
    work_close_with(&open);

    // On another machine — a recent list that has never seen the work.
    let (other_db, other_open) = host();
    let elsewhere = Scratch::create();
    let restored = backup_restore_with(
        &other_db,
        &other_open,
        &text(&path),
        &text(&elsewhere.path().join("Here")),
    )
    .unwrap();
    assert_eq!(restored.moved_recent_from, None);
    assert_eq!(
        backup_inspect_with(&other_db, &text(&path))
            .unwrap()
            .recent_folder,
        Some(text(&elsewhere.path().join("Here")))
    );
    work_close_with(&other_open);
}

/// A backup of a work at schema 7 — F6's — restores into this build, migrates
/// forward as any old work does, and keeps its chain and its files.
#[test]
fn a_backup_of_a_work_at_an_older_schema_restores_migrated_forward() {
    let (db, open) = host();
    let scratch = Scratch::create();
    let old = scratch.path().join("Old");
    std::fs::create_dir(&old).unwrap();
    let documents = old.join(intake::DOCUMENTS);
    std::fs::create_dir(&documents).unwrap();
    let photo = png(64, 48);
    let photo_hash = intake::sha256_hex(&photo);
    std::fs::write(documents.join(format!("{photo_hash}.png")), &photo).unwrap();

    let backups = Scratch::create();
    let path = backups.path().join("old.ridgebeam");
    {
        let conn = Connection::open(old.join(WORK_FILE)).unwrap();
        db::configure(&conn).unwrap();
        db::work::tests::a_work_at_schema_one(&conn);
        migrations::WORK.apply_up_to(&conn, 7).unwrap();
        db::diary::append(
            &conn,
            &db::diary::NewEntry {
                day: "2026-10-05".into(),
                kind: "entry".into(),
                corrects_seq: None,
                note: Some("Tiles laid.".into()),
                weather: None,
                lost_day: false,
                lost_cause: None,
                lost_party_person_id: None,
                hours: None,
                deliveries: None,
                incidents: None,
                visitors: None,
                author_name: "Synthetic author".into(),
                done: Vec::new(),
                present: Vec::new(),
                photos: vec![crate::contract::Photo {
                    file_hash: photo_hash.clone(),
                    file_name: "wall.png".into(),
                    bytes: photo.len() as i64,
                    width: 64,
                    height: 48,
                    thumbnail: false,
                    converted_from: None,
                }],
            },
        )
        .unwrap();
        let written = format::write(&conn, &old, &path, false, now()).unwrap();
        assert_eq!(written.manifest.schema_version, 7);
        assert_eq!(migrations::WORK.current_version(&conn), 7);
    }
    assert_eq!(
        backup_inspect_with(&db, &text(&path))
            .unwrap()
            .schema_version,
        7
    );

    let target = scratch.path().join("Restored");
    let restored = backup_restore_with(&db, &open, &text(&path), &text(&target)).unwrap();

    assert_eq!((restored.entries, restored.chain_ok), (1, true));
    assert_eq!(restored.documents, 1, "the photo became a document");
    assert!(restored.mismatched.is_empty() && restored.missing.is_empty());
    let plan = work_get_with(&open).unwrap();
    assert_eq!(plan.documents[0].file_hash, photo_hash);
    assert_eq!(plan.activities[0].name, "Tiling");
    {
        let slot = lock(&open.0);
        assert_eq!(
            migrations::WORK.current_version(&slot.as_ref().unwrap().conn),
            migrations::WORK.target_version()
        );
    }
    work_close_with(&open);
    assert_eq!(
        names_in(&old),
        vec![intake::DOCUMENTS, WORK_FILE],
        "the old folder is untouched by the restore"
    );
    let still = read_only(&old.join(WORK_FILE));
    assert_eq!(migrations::WORK.current_version(&still), 7);
}

#[test]
fn a_backup_is_refused_inside_the_work_s_own_folder_and_replaces_a_file_only_when_asked() {
    let (db, open, _scratch) = host_with_a_work();
    let inside = folder_of(&open).join("backup.ridgebeam");
    let refused = backup_write_with(&db, &open, &text(&inside), false, now()).unwrap_err();
    assert_eq!(
        refused.to_string(),
        "“backup.ridgebeam” was not saved: a backup inside the work's own folder would be lost with it."
    );
    assert!(!inside.exists());

    let backups = Scratch::create();
    let path = backups.path().join("b.ridgebeam");
    std::fs::write(&path, "an older file").unwrap();
    let refused = backup_write_with(&db, &open, &text(&path), false, now()).unwrap_err();
    assert!(
        refused.to_string().contains("choose it in the save dialog"),
        "{refused}"
    );
    assert_eq!(std::fs::read(&path).unwrap(), b"an older file");

    backup_write_with(&db, &open, &text(&path), true, now()).unwrap();
    assert_eq!(&std::fs::read(&path).unwrap()[..4], b"PK\x03\x04");
    assert_eq!(names_in(backups.path()), vec!["b.ridgebeam"]);

    for (bad, words) in [
        ("relative.ridgebeam", "full path"),
        (
            &*text(&backups.path().join("b.zip")),
            "a backup is a .ridgebeam file",
        ),
    ] {
        let refused = backup_write_with(&db, &open, bad, false, now()).unwrap_err();
        assert!(refused.to_string().contains(words), "{refused}");
    }
    work_close_with(&open);
    assert_eq!(
        backup_write_with(&db, &open, &text(&path), true, now())
            .unwrap_err()
            .kind(),
        "no_work_open"
    );
}

/// A file in `documents/` whose name a backup never holds is left out and
/// named — so the backup still restores.
#[test]
fn a_file_the_allow_list_does_not_take_is_left_out_and_named() {
    let (db, open, scratch) = host_with_a_work();
    let folder = folder_of(&open);
    std::fs::create_dir(folder.join("documents")).unwrap();
    std::fs::write(folder.join("documents").join("notes.txt"), "left here").unwrap();
    std::fs::create_dir(folder.join("thumbnails")).unwrap();
    std::fs::create_dir(folder.join("thumbnails").join("sub")).unwrap();
    let backups = Scratch::create();
    let path = backups.path().join("b.ridgebeam");

    let written = backup_write_with(&db, &open, &text(&path), false, now()).unwrap();

    assert_eq!(
        written.left_out,
        vec!["documents/notes.txt", "thumbnails/sub/"]
    );
    work_close_with(&open);
    backup_restore_with(&db, &open, &text(&path), &text(&scratch.path().join("R"))).unwrap();
    work_close_with(&open);
}

#[test]
fn the_last_backup_is_the_day_it_was_written_per_work_and_null_before_the_first() {
    let (db, open, _scratch) = host_with_a_work();
    assert_eq!(backup_last_with(&db, &open).unwrap(), None);
    let backups = Scratch::create();
    backup_write_with(
        &db,
        &open,
        &text(&backups.path().join("b.ridgebeam")),
        false,
        now(),
    )
    .unwrap();

    let last = backup_last_with(&db, &open).unwrap().unwrap();
    assert_eq!(last.day, "2026-10-09");
    assert_eq!(
        serde_json::to_value(&last).unwrap(),
        json!({ "day": "2026-10-09" })
    );
    work_close_with(&open);
    assert_eq!(
        backup_last_with(&db, &open).unwrap_err().kind(),
        "no_work_open"
    );
}

#[test]
fn inspect_reads_the_manifest_without_restoring_anything() {
    let work = a_full_work();
    let backups = Scratch::create();
    let path = backups.path().join("b.ridgebeam");
    let written = backup_write_with(&work.db, &work.open, &text(&path), false, now()).unwrap();
    work_close_with(&work.open);
    let around = names_in(backups.path());

    let summary = backup_inspect_with(&work.db, &text(&path)).unwrap();

    assert_eq!(summary.work_name, "Synthetic bathroom");
    assert_eq!(summary.files, written.files);
    assert_eq!(summary.archive_bytes, written.bytes);
    assert!(summary.bytes > 0);
    assert_eq!(summary.schema_version, migrations::WORK.target_version());
    assert_eq!(
        summary.app,
        format!("Ridgebeam {}", env!("CARGO_PKG_VERSION"))
    );
    let wire = serde_json::to_value(&summary).unwrap();
    for key in [
        "workName",
        "workId",
        "createdAt",
        "app",
        "schemaVersion",
        "files",
        "bytes",
        "archiveBytes",
        "recentFolder",
    ] {
        assert!(wire.get(key).is_some(), "`{key}` is on the wire");
    }
    assert_eq!(names_in(backups.path()), around, "nothing written");
    let wire = serde_json::to_value(&written).unwrap();
    for key in ["path", "bytes", "files", "leftOut"] {
        assert!(wire.get(key).is_some(), "`{key}` is on the wire");
    }
}

/// A backup restored while another work is open: the restored one is open
/// afterwards, the other closed cleanly — one file.
#[test]
fn a_restore_opens_the_restored_work_and_closes_the_one_that_was_open() {
    let (db, open, scratch) = host_with_a_work();
    let backups = Scratch::create();
    let path = backups.path().join("b.ridgebeam");
    backup_write_with(&db, &open, &text(&path), false, now()).unwrap();
    let first_folder = folder_of(&open);
    work_open_with(&db, &open, &text(&first_folder)).unwrap();

    let target = scratch.path().join("Second copy");
    backup_restore_with(&db, &open, &text(&path), &text(&target)).unwrap();

    assert_eq!(folder_of(&open), target);
    assert_eq!(names_in(&first_folder), vec![WORK_FILE]);
    work_close_with(&open);
    assert!(folder::is_present(&target));
}
