//! The report commands against a real work on disk: what each writes, what the
//! second reader finds in it, and everything each refuses — writing nothing.
//! Every name, note and file here is synthetic.

use std::path::{Path, PathBuf};

use chrono::NaiveDate;
use serde::Deserialize;

use crate::commands::diary::diary_entry_add_with;
use crate::commands::plan::{activity_add_with, person_add_with, stage_add_with};
use crate::commands::reports::*;
use crate::commands::work::tests::{host, host_with_a_work};
use crate::commands::work::{work_close_with, work_get_with};
use crate::contract::{DiaryEntry, EntryDraft, WorkSnapshot};
use crate::db::lock;
use crate::db::testing::Scratch;
use crate::files::intake::{self, tests::png};
use crate::folder::OpenWork;
use crate::report::csv::{BOM, COLUMNS};
use crate::report::model::tests::every_block;
use crate::report::model::{ReportDocument, ReportKind, MAX_BLOCKS};
use crate::report::reader_tests::read;

const CREATED_AT: &str = "2026-10-09T14:05:30-03:00";

fn today() -> NaiveDate {
    NaiveDate::from_ymd_opt(2026, 10, 9).unwrap()
}

fn files_in(folder: &Path) -> Vec<String> {
    let mut names: Vec<String> = std::fs::read_dir(folder)
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    names
}

fn at(scratch: &Scratch, name: &str) -> String {
    scratch.path().join(name).to_string_lossy().into_owned()
}

fn entry(value: serde_json::Value) -> EntryDraft {
    serde_json::from_value(value).expect("a draft the interface could send")
}

/// A work with a diary of three entries: one with a photo, a person present
/// and a formula for a note; one plain; and a correction of the first,
/// re-attaching its photo. The author, the person and the activity are named
/// so that each would start a formula.
struct Site {
    open: OpenWork,
    _work: Scratch,
    photo_hash: String,
}

fn a_site() -> Site {
    let (_db, open, work) = host_with_a_work();
    let stage = stage_add_with(&open, "Bathroom").unwrap().stages[0]
        .id
        .clone();
    let tiling = activity_add_with(&open, &stage, "+Tiling")
        .unwrap()
        .activities[0]
        .id
        .clone();
    let person = person_add_with(&open, "-Ana (synthetic)").unwrap().people[0]
        .id
        .clone();

    let source = Scratch::create();
    let photo = source.path().join("wall.png");
    let bytes = png(64, 48);
    std::fs::write(&photo, &bytes).unwrap();
    let photo_hash = intake::sha256_hex(&bytes);

    let author = "@Author (synthetic)";
    diary_entry_add_with(
        &open,
        &entry(serde_json::json!({
            "day": "2026-10-05", "kind": "entry", "weather": "rain",
            "note": "=HYPERLINK(\"http://example.invalid\")\nsecond line, with a comma",
            "present": [person],
            "done": [{ "activityId": tiling, "state": "finished", "quantity": 12 }],
            "photoPaths": [photo.to_string_lossy()]
        })),
        today(),
        author,
    )
    .unwrap();
    diary_entry_add_with(
        &open,
        &entry(serde_json::json!({
            "day": "2026-10-06", "kind": "entry", "note": "Grout; \"sealed\"",
            "done": [{ "activityId": tiling, "state": "worked" }]
        })),
        today(),
        author,
    )
    .unwrap();
    diary_entry_add_with(
        &open,
        &entry(serde_json::json!({
            "day": "2026-10-05", "kind": "correction", "correctsSeq": 1,
            "note": "It was the kitchen wall.", "photoHashes": [photo_hash]
        })),
        today(),
        author,
    )
    .unwrap();
    Site {
        open,
        _work: work,
        photo_hash,
    }
}

/// The diary document the interface would compose for this site.
fn diary_document() -> ReportDocument {
    serde_json::from_value(serde_json::json!({
        "kind": "diary", "title": "Diary — Synthetic bathroom", "subtitle": "3 entries",
        "pageSize": "a4", "language": "en",
        "blocks": [
            { "type": "heading", "level": 2, "text": "#1 · 2026-10-05" },
            { "type": "paragraph", "text": "=HYPERLINK(\"http://example.invalid\")" },
            { "type": "heading", "level": 2, "text": "#2 · 2026-10-06" },
            { "type": "paragraph", "text": "Grout; \"sealed\"" },
            { "type": "heading", "level": 2, "text": "#3 · 2026-10-05 · corrects #1" },
            { "type": "paragraph", "text": "It was the kitchen wall." }
        ]
    }))
    .unwrap()
}

/// Break the chain the way only somebody with the file could: drop the
/// trigger and rewrite a note.
fn tamper(open: &OpenWork) {
    let slot = lock(&open.0);
    slot.as_ref()
        .unwrap()
        .conn
        .execute_batch(
            "DROP TRIGGER diary_entry_no_update;
             UPDATE diary_entry SET note = 'Nothing was laid.' WHERE seq = 2;",
        )
        .unwrap();
}

/// A CSV read as RFC 4180 says: records of fields, quotes undone.
fn parse_csv(text: &str, separator: char) -> Vec<Vec<String>> {
    let mut records = Vec::new();
    let mut record = Vec::new();
    let mut field = String::new();
    let mut quoted = false;
    let mut characters = text.chars().peekable();
    while let Some(c) = characters.next() {
        match (quoted, c) {
            (true, '"') if characters.peek() == Some(&'"') => {
                characters.next();
                field.push('"');
            }
            (true, '"') => quoted = false,
            (true, c) => field.push(c),
            (false, '"') if field.is_empty() => quoted = true,
            (false, c) if c == separator => record.push(std::mem::take(&mut field)),
            (false, '\r') if characters.peek() == Some(&'\n') => {}
            (false, '\n') => {
                record.push(std::mem::take(&mut field));
                records.push(std::mem::take(&mut record));
            }
            (false, c) => field.push(c),
        }
    }
    assert!(
        field.is_empty() && record.is_empty(),
        "the file ends at a line's end"
    );
    records
}

#[test]
fn a_weekly_report_is_written_whole_and_the_second_reader_finds_its_words() {
    let (_db, _open) = host();
    let written = Written::default();
    let folder = Scratch::create();
    let path = at(&folder, "weekly.pdf");

    let file = report_pdf_write_with(
        &OpenWork::default(),
        &written,
        &path,
        &every_block(),
        false,
        CREATED_AT,
    )
    .unwrap();

    assert_eq!(file.path, path);
    let bytes = std::fs::read(&path).unwrap();
    assert_eq!(file.bytes, bytes.len() as u64);
    assert_eq!(file.pages, Some(2));
    let reading = read(&bytes);
    assert_eq!(reading.pages.len(), 2);
    assert!(reading
        .text()
        .contains("Two entries were written this week."));
    assert_eq!(
        files_in(folder.path()),
        vec!["weekly.pdf"],
        "no temporary file"
    );

    let wire = serde_json::to_value(&file).unwrap();
    assert_eq!(
        wire.as_object().unwrap().keys().collect::<Vec<_>>(),
        vec!["bytes", "pages", "path"]
    );
}

#[test]
fn a_report_that_cannot_be_written_is_refused_and_nothing_is_written() {
    let written = Written::default();
    let folder = Scratch::create();
    let pdf = at(&folder, "weekly.pdf");
    let diary = ReportDocument {
        kind: ReportKind::Diary,
        ..every_block()
    };
    let too_long = ReportDocument {
        blocks: vec![crate::report::model::Block::Rule; MAX_BLOCKS + 1],
        ..every_block()
    };
    for (path, document, date, sentence) in [
        (pdf.clone(), diary, CREATED_AT, DIARY_ELSEWHERE.to_string()),
        (
            pdf.clone(),
            too_long,
            CREATED_AT,
            "A report holds at most 5000 blocks; this one has 5001.".to_string(),
        ),
        (
            pdf.clone(),
            every_block(),
            "yesterday",
            crate::report::CREATED_AT.to_string(),
        ),
        (
            at(&folder, "weekly.txt"),
            every_block(),
            CREATED_AT,
            "“weekly.txt” was not saved: a report is a .pdf file.".to_string(),
        ),
        (
            "weekly.pdf".to_string(),
            every_block(),
            CREATED_AT,
            crate::report::FULL_PATH.to_string(),
        ),
        (
            at(&folder, "nowhere/weekly.pdf"),
            every_block(),
            CREATED_AT,
            "“weekly.pdf” was not saved: the folder it would go in is not there.".to_string(),
        ),
    ] {
        let refused =
            report_pdf_write_with(&OpenWork::default(), &written, &path, &document, true, date)
                .unwrap_err();
        assert_eq!(refused.kind(), "invalid_input");
        assert_eq!(refused.to_string(), sentence);
    }
    assert!(files_in(folder.path()).is_empty());
}

#[test]
fn an_existing_file_is_replaced_only_when_the_save_dialog_chose_it() {
    let written = Written::default();
    let folder = Scratch::create();
    let path = at(&folder, "Weekly.PDF");
    std::fs::write(&path, "somebody's file").unwrap();

    let refused = report_pdf_write_with(
        &OpenWork::default(),
        &written,
        &path,
        &every_block(),
        false,
        CREATED_AT,
    )
    .unwrap_err();
    assert_eq!(
        refused.to_string(),
        "“Weekly.PDF” was not saved: a file of that name is already there; choose it in the save dialog to replace it."
    );
    assert_eq!(std::fs::read_to_string(&path).unwrap(), "somebody's file");

    report_pdf_write_with(
        &OpenWork::default(),
        &written,
        &path,
        &every_block(),
        true,
        CREATED_AT,
    )
    .expect("chosen in the save dialog; .PDF in any case");
    assert!(std::fs::read(&path).unwrap().starts_with(b"%PDF-"));
    assert_eq!(files_in(folder.path()), vec!["Weekly.PDF"]);
}

#[test]
fn the_diary_pdf_carries_the_hosts_verification_block_and_every_entrys_words() {
    let site = a_site();
    let written = Written::default();
    let folder = Scratch::create();
    let path = at(&folder, "diary.pdf");
    let head = crate::db::diary::all(&lock(&site.open.0).as_ref().unwrap().conn)
        .unwrap()
        .last()
        .unwrap()
        .hash
        .clone();

    let file = diary_export_pdf_with(
        &site.open,
        &written,
        &path,
        &diary_document(),
        false,
        CREATED_AT,
    )
    .unwrap();

    let reading = read(&std::fs::read(&path).unwrap());
    assert_eq!(file.pages, Some(reading.pages.len()));
    let text = reading.text();
    for words in [
        format!(
            "Chain verified on 2026-10-09: 3 entries, head {}.",
            &head[..16]
        ),
        "This is tamper-evidence: it shows whether the file was changed outside Ridgebeam."
            .to_string(),
        "It is not a signature and not legal proof.".to_string(),
        "=HYPERLINK(\"http://example.invalid\")".to_string(),
        "Grout; \"sealed\"".to_string(),
        "It was the kitchen wall.".to_string(),
        "#3 · 2026-10-05 · corrects #1".to_string(),
    ] {
        assert!(text.contains(&words), "{words:?} in {text}");
    }
    assert!(
        text.find("Chain verified").unwrap() < text.find("#1 · 2026-10-05").unwrap(),
        "the host's block comes first"
    );

    let other = diary_export_pdf_with(
        &site.open,
        &written,
        &path,
        &every_block(),
        true,
        CREATED_AT,
    )
    .unwrap_err();
    assert_eq!(other.to_string(), NOT_THE_DIARY);
    work_close_with(&site.open);
}

#[test]
fn the_diary_csv_is_the_databases_rows_neutralised_quoted_with_a_bom() {
    let site = a_site();
    let written = Written::default();
    let folder = Scratch::create();
    let path = at(&folder, "diary.csv");

    let file = diary_export_csv_with(&site.open, &written, &path, ",", false).unwrap();

    assert_eq!(file.pages, None);
    let bytes = std::fs::read(&path).unwrap();
    assert_eq!(file.bytes, bytes.len() as u64);
    assert!(bytes.starts_with(b"\xEF\xBB\xBF"), "UTF-8 with a BOM");
    let text = String::from_utf8(bytes).unwrap();
    let records = parse_csv(text.strip_prefix(BOM).unwrap(), ',');
    assert_eq!(records.len(), 4, "the header and three entries");
    assert_eq!(records[0], COLUMNS.to_vec());
    assert_eq!(
        records[0][13..],
        ["lost_cause", "lost_party"],
        "E3's two columns come last: the thirteen before them stay where they were"
    );
    for record in &records {
        assert_eq!(record.len(), 15);
    }
    let entries: Vec<DiaryEntry> =
        crate::db::diary::all(&lock(&site.open.0).as_ref().unwrap().conn).unwrap();

    let first = &records[1];
    assert_eq!(first[0], "1");
    assert_eq!(first[1], "2026-10-05");
    assert_eq!(first[2], entries[0].created_at);
    assert_eq!(first[3], "'@Author (synthetic)", "an author is neutralised");
    assert_eq!(first[4], "rain");
    assert_eq!(first[5], "");
    assert_eq!(
        first[6], "'+Tiling (12)",
        "an activity's name is neutralised"
    );
    assert_eq!(
        first[7], "'-Ana (synthetic)",
        "a person's name is neutralised"
    );
    assert_eq!(
        first[8], "'=HYPERLINK(\"http://example.invalid\")\nsecond line, with a comma",
        "a note is neutralised, and its line break and comma kept inside quotes"
    );
    assert_eq!(first[9], "");
    assert_eq!(first[10], site.photo_hash);
    assert_eq!(first[11], entries[0].hash);
    assert_eq!(first[12], "");
    assert_eq!(
        (first[13].as_str(), first[14].as_str()),
        ("", ""),
        "no cause given"
    );

    let second = &records[2];
    assert_eq!(second[5], "'+Tiling");
    assert_eq!(second[8], "Grout; \"sealed\"");
    assert_eq!(second[12], entries[0].hash, "previous_hash is the chain");

    let correction = &records[3];
    assert_eq!(correction[9], "1", "corrects_seq");
    assert_eq!(correction[10], site.photo_hash, "the re-attached photo");
    assert_eq!(correction[11], entries[2].hash);
    assert_eq!(correction[12], entries[1].hash);

    // The raw file, as a spreadsheet would receive it.
    assert!(
        text.contains("\"'=HYPERLINK(\"\"http://example.invalid\"\")\nsecond line, with a comma\"")
    );
    assert!(text.contains("\r\n"));
    work_close_with(&site.open);
}

#[test]
fn the_diary_csv_takes_the_semicolon_a_portuguese_spreadsheet_expects() {
    let site = a_site();
    let written = Written::default();
    let folder = Scratch::create();
    let path = at(&folder, "diario.csv");

    diary_export_csv_with(&site.open, &written, &path, ";", false).unwrap();

    let text = std::fs::read_to_string(&path).unwrap();
    let body = text.strip_prefix(BOM).unwrap();
    assert!(body.starts_with("seq;day;created_at;author;"));
    let records = parse_csv(body, ';');
    assert_eq!(records.len(), 4);
    assert_eq!(records[2][8], "Grout; \"sealed\"", "quoted: it holds a ;");
    assert!(body.contains("\"Grout; \"\"sealed\"\"\""));
    assert!(
        records[1][8].contains("second line, with a comma"),
        "a comma needs no quotes with ;"
    );

    for other in ["\t", "|", ""] {
        let refused =
            diary_export_csv_with(&site.open, &written, &at(&folder, "x.csv"), other, false)
                .unwrap_err();
        assert_eq!(refused.to_string(), crate::report::csv::SEPARATOR);
    }
    assert_eq!(files_in(folder.path()), vec!["diario.csv"]);
    work_close_with(&site.open);
}

/// E3: a lost day's cause and the person it is put down to are in both
/// exports — the CSV's last two columns, the person by name and neutralised
/// like every other cell; the JSON's `lostCause` and `lostPartyPersonId`.
#[test]
fn a_lost_day_with_its_cause_and_person_is_in_the_csv_and_the_json() {
    let site = a_site();
    let person = work_get_with(&site.open).unwrap().people[0].id.clone();
    diary_entry_add_with(
        &site.open,
        &entry(serde_json::json!({
            "day": "2026-10-07", "kind": "entry", "lostDay": true,
            "lostCause": "absence", "lostPartyPersonId": person
        })),
        today(),
        "Synthetic author",
    )
    .unwrap();
    diary_entry_add_with(
        &site.open,
        &entry(serde_json::json!({
            "day": "2026-10-08", "kind": "entry", "lostDay": true, "lostCause": "weather"
        })),
        today(),
        "Synthetic author",
    )
    .unwrap();
    let written = Written::default();
    let folder = Scratch::create();

    let csv_path = at(&folder, "diary.csv");
    diary_export_csv_with(&site.open, &written, &csv_path, ",", false).unwrap();
    let text = std::fs::read_to_string(&csv_path).unwrap();
    let records = parse_csv(text.strip_prefix(BOM).unwrap(), ',');
    assert_eq!(records.len(), 6, "the header and five entries");
    assert_eq!(
        records[4][13..],
        ["absence", "'-Ana (synthetic)"],
        "the cause as stored; the person by name, neutralised"
    );
    assert_eq!(
        records[5][13..],
        ["weather", ""],
        "a cause put down to nobody"
    );

    let json_path = at(&folder, "work.json");
    work_export_json_with(
        &site.open,
        &written,
        &json_path,
        false,
        "2026-10-09T17:05:30.000Z",
    )
    .unwrap();
    let json: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(&json_path).unwrap()).unwrap();
    let diary = json["diary"].as_array().unwrap();
    assert_eq!(diary[3]["lostCause"], "absence");
    assert_eq!(diary[3]["lostPartyPersonId"], person.as_str());
    assert_eq!(diary[4]["lostCause"], "weather");
    assert!(diary[4]["lostPartyPersonId"].is_null());
    assert!(
        diary[0]["lostCause"].is_null() && diary[0]["lostPartyPersonId"].is_null(),
        "null, never absent"
    );
    work_close_with(&site.open);
}

#[test]
fn a_tampered_diary_refuses_both_exports_says_which_entry_broke_and_writes_nothing() {
    let site = a_site();
    let written = Written::default();
    let folder = Scratch::create();
    tamper(&site.open);

    let pdf = diary_export_pdf_with(
        &site.open,
        &written,
        &at(&folder, "diary.pdf"),
        &diary_document(),
        false,
        CREATED_AT,
    )
    .unwrap_err();
    let csv = diary_export_csv_with(&site.open, &written, &at(&folder, "diary.csv"), ",", false)
        .unwrap_err();

    for refused in [pdf, csv] {
        assert_eq!(refused.kind(), "invalid_input");
        assert_eq!(
            refused.to_string(),
            "The diary was not exported, because its chain does not verify. Entry #2 does not match its hash: something in it was changed after it was written."
        );
    }
    assert!(files_in(folder.path()).is_empty(), "nothing written");
    assert!(
        report_open_with(&written, &at(&folder, "diary.pdf"), |_| Ok(())).is_err(),
        "and nothing recorded as written"
    );
    work_close_with(&site.open);
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Export {
    ridgebeam_work: u32,
    exported_at: String,
    work: WorkSnapshot,
    diary: Vec<DiaryEntry>,
}

#[test]
fn the_work_as_json_reads_back_into_the_snapshot_and_the_diary() {
    let site = a_site();
    let written = Written::default();
    let folder = Scratch::create();
    let path = at(&folder, "work.json");
    // E2: the funds and the money received travel with the work.
    let savings = crate::commands::funding::funding_add_with(
        &site.open,
        &serde_json::from_value(serde_json::json!({
            "label": "Savings", "amountCents": 400000, "expectedOn": "2026-10-01"
        }))
        .unwrap(),
    )
    .unwrap()
    .funding[0]
        .id
        .clone();
    crate::commands::funding::funding_receipt_add_with(
        &site.open,
        &serde_json::from_value(serde_json::json!({
            "fundingId": savings, "amountCents": 400000, "day": "2026-10-02"
        }))
        .unwrap(),
        today(),
        "A. Owner (synthetic)",
    )
    .unwrap();
    // E4: a snag, with its photo by hash, travels with the work.
    let stage = work_get_with(&site.open).unwrap().stages[0].id.clone();
    crate::commands::snags::snag_raise_with(
        &site.open,
        &serde_json::from_value(serde_json::json!({
            "raisedOn": "2026-10-07", "title": "Cracked tile", "stageId": stage,
            "photoHash": site.photo_hash
        }))
        .unwrap(),
        today(),
        "A. Owner (synthetic)",
    )
    .unwrap();

    // G1: a meeting's minutes, an action open, travel with the work.
    crate::commands::meetings::meeting_close_with(
        &site.open,
        &serde_json::from_value(serde_json::json!({
            "heldOn": "2026-10-08", "attendees": [ { "name": "The neighbour" } ],
            "items": [ { "kind": "other", "title": "The skip" } ],
            "actions": [ { "text": "Move the skip" } ]
        }))
        .unwrap(),
        today(),
        "A. Owner (synthetic)",
    )
    .unwrap();

    // G2: a purchase, ordered, travels with the work.
    let worktop = crate::commands::purchases::purchase_add_with(
        &site.open,
        &serde_json::from_value(serde_json::json!({
            "stageId": stage, "name": "Worktop", "leadDays": 21
        }))
        .unwrap(),
    )
    .unwrap()
    .purchases[0]
        .id
        .clone();
    crate::commands::purchases::purchase_event_add_with(
        &site.open,
        &serde_json::from_value(serde_json::json!({
            "purchaseId": worktop, "kind": "ordered", "day": "2026-10-08"
        }))
        .unwrap(),
        today(),
        "A. Owner (synthetic)",
    )
    .unwrap();

    // G4: a warranty and a task done travel with the work.
    crate::commands::aftercare::warranty_add_with(
        &site.open,
        &serde_json::from_value(serde_json::json!({
            "targetKind": "stage", "targetId": stage, "title": "Worktop",
            "startsOn": "2026-10-08", "months": 120
        }))
        .unwrap(),
    )
    .unwrap();
    let oil = crate::commands::aftercare::maintenance_add_with(
        &site.open,
        &serde_json::from_value(serde_json::json!({
            "targetKind": "stage", "targetId": stage, "title": "Oil the worktop",
            "everyMonths": 6, "firstDueOn": "2027-04-08"
        }))
        .unwrap(),
    )
    .unwrap()
    .maintenance[0]
        .id
        .clone();
    crate::commands::aftercare::maintenance_done_add_with(
        &site.open,
        &serde_json::from_value(serde_json::json!({ "taskId": oil, "doneOn": "2026-10-09" }))
            .unwrap(),
        today(),
        "A. Owner (synthetic)",
    )
    .unwrap();

    let file = work_export_json_with(
        &site.open,
        &written,
        &path,
        false,
        "2026-10-09T17:05:30.000Z",
    )
    .unwrap();

    assert_eq!(file.pages, None);
    let text = std::fs::read_to_string(&path).unwrap();
    assert!(
        text.starts_with("{\n  \"ridgebeamWork\": 1,"),
        "pretty-printed"
    );
    assert!(!text.starts_with('\u{FEFF}'));
    let export: Export = serde_json::from_str(&text).expect("serde reads it back");
    assert_eq!(export.ridgebeam_work, 1);
    assert_eq!(export.exported_at, "2026-10-09T17:05:30.000Z");
    assert_eq!(export.work, work_get_with(&site.open).unwrap());
    assert_eq!(export.work.work.name, "Synthetic bathroom");
    assert_eq!(export.work.funding[0].id, savings);
    assert_eq!(
        export.work.funding_receipts[0].funding_id.as_deref(),
        Some(savings.as_str())
    );
    assert!(text.contains("\"fundingReceipts\": ["));
    assert_eq!(
        export.work.snags[0].photo_hash.as_deref(),
        Some(site.photo_hash.as_str())
    );
    assert!(
        text.contains("\"closure\": null"),
        "open, and null never absent"
    );
    assert_eq!(export.work.meetings[0].actions[0].text, "Move the skip");
    assert!(text.contains("\"meetings\": ["));
    assert!(
        text.contains("\"personId\": null"),
        "an action on nobody, and null never absent"
    );
    assert_eq!(export.work.purchases[0].id, worktop);
    assert_eq!(export.work.purchases[0].events[0].kind, "ordered");
    assert!(text.contains("\"purchases\": ["));
    assert_eq!(export.work.warranties[0].months, 120);
    assert_eq!(export.work.maintenance[0].id, oil);
    assert_eq!(export.work.maintenance[0].done[0].done_on, "2026-10-09");
    assert!(text.contains("\"warranties\": ["));
    assert!(text.contains("\"maintenance\": ["));
    assert!(
        text.contains("\"documentId\": null"),
        "a warranty with no paper, and null never absent"
    );
    assert!(
        text.contains("\"supplier\": null"),
        "a supplier not said, and null never absent"
    );
    assert_eq!(
        export.diary,
        crate::db::diary::all(&lock(&site.open.0).as_ref().unwrap().conn).unwrap()
    );
    assert_eq!(export.diary.len(), 3);
    assert_eq!(export.diary[0].photos[0].file_hash, site.photo_hash);
    assert!(
        !text.contains("base64") && text.len() < 64 * 1024,
        "files are named by hash, not embedded"
    );
    work_close_with(&site.open);
}

#[test]
fn report_open_opens_only_a_file_this_session_wrote() {
    let written = Written::default();
    let folder = Scratch::create();
    let path = at(&folder, "weekly.pdf");
    let someone_elses = at(&folder, "other.pdf");
    std::fs::write(&someone_elses, "%PDF-1.7").unwrap();

    for path in [
        someone_elses.as_str(),
        "weekly.pdf",
        path.as_str(),
        "C:\\Windows\\System32\\notepad.exe",
    ] {
        let refused =
            report_open_with(&written, path, |_| panic!("nothing is opened")).unwrap_err();
        assert_eq!(refused.kind(), "invalid_input");
        assert_eq!(refused.to_string(), NOT_WRITTEN_HERE);
    }

    report_pdf_write_with(
        &OpenWork::default(),
        &written,
        &path,
        &every_block(),
        false,
        CREATED_AT,
    )
    .unwrap();
    let mut opened: Option<PathBuf> = None;
    report_open_with(&written, &path, |file| {
        opened = Some(file.to_path_buf());
        Ok(())
    })
    .unwrap();
    assert_eq!(opened, Some(PathBuf::from(&path)));

    let another_session = Written::default();
    assert!(
        report_open_with(&another_session, &path, |_| panic!("nothing is opened")).is_err(),
        "the set is this session's"
    );
}

#[test]
fn the_exports_that_read_the_work_need_one_open() {
    let (_db, open) = host();
    let written = Written::default();
    let folder = Scratch::create();
    assert_eq!(
        diary_export_csv_with(&open, &written, &at(&folder, "d.csv"), ",", false)
            .unwrap_err()
            .kind(),
        "no_work_open"
    );
    assert_eq!(
        diary_export_pdf_with(
            &open,
            &written,
            &at(&folder, "d.pdf"),
            &diary_document(),
            false,
            CREATED_AT
        )
        .unwrap_err()
        .kind(),
        "no_work_open"
    );
    assert_eq!(
        work_export_json_with(&open, &written, &at(&folder, "w.json"), false, "x")
            .unwrap_err()
            .kind(),
        "no_work_open"
    );
    assert!(files_in(folder.path()).is_empty());
}
