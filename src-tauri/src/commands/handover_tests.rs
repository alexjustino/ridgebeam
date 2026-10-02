//! The handover book's host side (D3) against a real work on disk: photos
//! found by hash among the open work's documents and nowhere else, embedded
//! once each as JPEG within 1 600 px, a small JPEG passed through without its
//! metadata, and everything that is not a photo of this work refused with a
//! sentence — writing nothing. Every file here is synthetic, generated in the
//! test.

use std::path::Path;

use chrono::NaiveDate;
use serde_json::{json, Value};

use crate::commands::diary::diary_entry_add_with;
use crate::commands::documents::document_add_with;
use crate::commands::documents::tests::minimal_pdf;
use crate::commands::reports::{diary_export_pdf_with, report_pdf_write_with, Written};
use crate::commands::work::tests::host_with_a_work;
use crate::commands::work::{with_work, work_close_with, work_get_with};
use crate::contract::EntryDraft;
use crate::db::testing::Scratch;
use crate::db::Db;
use crate::files::intake::{self, tests::jpeg, tests::png};
use crate::folder::OpenWork;
use crate::report::images::tests::{header_markers, jpeg_with_metadata};
use crate::report::images::{self, MAX_IMAGE_BYTES, TOO_MUCH_IMAGE_DATA};
use crate::report::model::ReportDocument;
use crate::report::reader_tests::read;

const CREATED_AT: &str = "2026-10-09T14:05:30-03:00";
const AUTHOR: &str = "Synthetic owner";

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

/// A work holding three photos — a PNG, a JPEG past 1 600 px, and a small
/// JPEG carrying a phone's metadata — and a warranty PDF.
struct Book {
    _db: Db,
    open: OpenWork,
    _work: Scratch,
    png: String,
    wiring: String,
    floor: String,
    floor_clean: Vec<u8>,
    warranty: String,
    out: Scratch,
}

fn a_book() -> Book {
    let (db, open, work) = host_with_a_work();
    let source = Scratch::create();
    let put = |name: &str, bytes: &[u8]| -> (String, String) {
        let path = source.path().join(name);
        std::fs::write(&path, bytes).unwrap();
        (
            path.to_string_lossy().into_owned(),
            intake::sha256_hex(bytes),
        )
    };
    let (png_path, png) = put("pipes.png", &png(1200, 900));
    let (wiring_path, wiring) = put("wiring.jpg", &jpeg(2400, 1800));
    let (floor_bytes, floor_clean) = jpeg_with_metadata(640, 480);
    let (floor_path, floor) = put("floor.jpg", &floor_bytes);
    let (warranty_path, warranty) = put("shower-warranty.pdf", &minimal_pdf());
    let added = document_add_with(
        &open,
        &[png_path, wiring_path, floor_path],
        "photo",
        None,
        today(),
        AUTHOR,
    )
    .unwrap();
    assert!(added.refused.is_empty());
    let added =
        document_add_with(&open, &[warranty_path], "warranty", None, today(), AUTHOR).unwrap();
    let kinds: Vec<&str> = added
        .snapshot
        .documents
        .iter()
        .map(|d| d.kind.as_str())
        .collect();
    assert_eq!(kinds, vec!["photo", "photo", "photo", "warranty"]);
    Book {
        _db: db,
        open,
        _work: work,
        png,
        wiring,
        floor,
        floor_clean,
        warranty,
        out: Scratch::create(),
    }
}

fn image(hash: &str, caption: &str, size: &str) -> Value {
    json!({ "type": "image", "hash": hash, "caption": caption, "size": size })
}

fn handover(blocks: Vec<Value>) -> ReportDocument {
    serde_json::from_value(json!({
        "kind": "handover", "title": "Handover book — Synthetic bathroom",
        "subtitle": "Written while the work was in progress", "pageSize": "a4",
        "language": "en", "blocks": blocks
    }))
    .expect("a document the interface could send")
}

impl Book {
    fn write(&self, document: &ReportDocument) -> crate::error::Result<Vec<u8>> {
        let path = self.out.path().join("handover.pdf");
        let path = path.to_string_lossy().into_owned();
        report_pdf_write_with(
            &self.open,
            &Written::default(),
            &path,
            document,
            true,
            CREATED_AT,
        )?;
        Ok(std::fs::read(&path).unwrap())
    }

    fn documents(&self) -> std::path::PathBuf {
        with_work(&self.open, |state| Ok(state.folder.join(intake::DOCUMENTS))).unwrap()
    }
}

#[test]
fn a_handover_book_embeds_the_works_photos_once_each_within_1600_px_and_a_small_jpeg_without_its_metadata(
) {
    let book = a_book();
    let document = handover(vec![
        json!({ "type": "heading", "level": 1, "text": "Bathroom" }),
        image(
            &book.png,
            "Pipes before the wall was closed — 2026-10-05",
            "full",
        ),
        image(&book.wiring, "Wiring, north wall", "half"),
        image(&book.floor, "The finished floor", "half"),
        json!({ "type": "paragraph", "text": "Warranty: shower-warranty.pdf" }),
        json!({ "type": "heading", "level": 1, "text": "Hall" }),
        image(
            &book.png,
            "Pipes before the wall was closed — 2026-10-05",
            "full",
        ),
    ]);

    let bytes = book.write(&document).unwrap();
    let reading = read(&bytes);

    assert_eq!(reading.images.len(), 3, "each distinct photo once");
    assert_eq!(reading.placements, 4, "the repeated photo drawn twice");
    for object in &reading.images {
        assert_eq!(object.filter, "DCTDecode");
        assert_eq!(object.colour_space, "DeviceRGB");
        assert!(object.width.max(object.height) <= 1600, "{object:?}");
        assert!(
            !header_markers(&object.bytes).contains(&0xE1),
            "no APP1 in the PDF"
        );
        assert!(!object.bytes.windows(4).any(|w| w == b"Exif"));
    }
    let sizes: Vec<(i64, i64)> = reading.images.iter().map(|i| (i.width, i.height)).collect();
    for expected in [(1200, 900), (1600, 1200), (640, 480)] {
        assert!(sizes.contains(&expected), "{expected:?} in {sizes:?}");
    }
    assert!(
        reading.images.iter().any(|i| i.bytes == book.floor_clean),
        "the small JPEG's picture byte for byte, its metadata gone"
    );
    let text = reading.text();
    for words in [
        "Bathroom",
        "Pipes before the wall was closed — 2026-10-05",
        "Wiring, north wall",
        "The finished floor",
        "Warranty: shower-warranty.pdf",
        "Written while the work was in progress",
    ] {
        assert!(text.contains(words), "{words:?} in {text}");
    }
    work_close_with(&book.open);
}

/// A photo is named by a hash the open work's documents hold, and found in
/// its own `documents/` — nothing else is printed, and a refusal writes
/// nothing.
#[test]
fn a_photo_that_is_not_one_of_this_works_documents_is_refused_and_nothing_is_written() {
    let book = a_book();

    // A file in `documents/` that no document names: there, but not the work's.
    let orphan_bytes = png(10, 10);
    let orphan = intake::sha256_hex(&orphan_bytes);
    std::fs::write(
        book.documents().join(format!("{orphan}.png")),
        &orphan_bytes,
    )
    .unwrap();
    // A photo in another folder entirely.
    let elsewhere = Scratch::create();
    let outside_bytes = png(12, 12);
    let outside = intake::sha256_hex(&outside_bytes);
    std::fs::create_dir(elsewhere.path().join(intake::DOCUMENTS)).unwrap();
    std::fs::write(
        elsewhere
            .path()
            .join(intake::DOCUMENTS)
            .join(format!("{outside}.png")),
        &outside_bytes,
    )
    .unwrap();

    let path_like = "Block 2 is an image that is not named by a hash: an image is named by the 64 lowercase hexadecimal digits of its file's SHA-256, never by a path.";
    let cases: Vec<(String, String)> = vec![
        (
            "ab".repeat(32),
            "Block 2 is a photo that is not in this work.".into(),
        ),
        (orphan, "Block 2 is a photo that is not in this work.".into()),
        (outside, "Block 2 is a photo that is not in this work.".into()),
        (
            book.warranty.clone(),
            "Block 2 names a PDF: a report lists a PDF by its name and never prints it as an image."
                .into(),
        ),
        ("../work.sqlite3".into(), path_like.into()),
        (
            book.documents()
                .join(format!("{}.png", book.png))
                .to_string_lossy()
                .into_owned(),
            path_like.into(),
        ),
        (book.png.to_uppercase(), path_like.into()),
    ];
    for (hash, sentence) in cases {
        let document = handover(vec![
            json!({ "type": "paragraph", "text": "Before." }),
            image(&hash, "A photo", "full"),
        ]);
        let refused = book.write(&document).unwrap_err();
        assert_eq!(refused.kind(), "invalid_input", "{hash}");
        assert_eq!(refused.to_string(), sentence, "{hash}");
        assert!(
            files_in(book.out.path()).is_empty(),
            "{hash}: nothing written"
        );
    }

    // The file changed outside Ridgebeam: its bytes are not the hash's.
    let original = book.documents().join(format!("{}.png", book.png));
    std::fs::write(&original, png(30, 30)).unwrap();
    let document = handover(vec![image(&book.png, "Pipes", "full")]);
    assert_eq!(
        book.write(&document).unwrap_err().to_string(),
        "Block 1 is a photo whose file is not the one recorded: it was changed outside Ridgebeam."
    );
    // The file gone.
    std::fs::remove_file(&original).unwrap();
    assert_eq!(
        book.write(&document).unwrap_err().to_string(),
        "Block 1 is a photo whose file is not in the work folder."
    );
    assert!(files_in(book.out.path()).is_empty());
    work_close_with(&book.open);
}

/// The F7 cap holds on the way out as on the way in: a document row naming a
/// file over 25 MiB — which no intake would have kept — is refused from the
/// file's size, before it is read.
#[test]
fn a_photo_over_25_mib_in_the_folder_is_refused_from_its_size() {
    let book = a_book();
    let huge = vec![0u8; 26 * 1024 * 1024];
    let hash = intake::sha256_hex(&huge);
    std::fs::write(book.documents().join(format!("{hash}.jpg")), &huge).unwrap();
    with_work(&book.open, |state| {
        state
            .conn
            .execute(
                "INSERT INTO document (id, file_hash, file_name, media_type, bytes, width, height,
                                       kind, title, added_on, author_name, created_at)
                 VALUES ('00000000-0000-7000-8000-0000000000e9', ?1, 'huge.jpg', 'image/jpeg',
                         ?2, 10, 10, 'photo', 'huge.jpg', '2026-10-05', 'x', 't')",
                rusqlite::params![hash, huge.len() as i64],
            )
            .unwrap();
        Ok(())
    })
    .unwrap();
    let refused = book
        .write(&handover(vec![image(&hash, "", "full")]))
        .unwrap_err();
    assert_eq!(
        refused.to_string(),
        "Block 1 is a photo that is larger than 25 MiB."
    );
    work_close_with(&book.open);
}

#[test]
fn the_caps_on_photos_placements_and_their_data_are_refused_with_sentences() {
    let book = a_book();

    // 401 distinct photos: refused before the work is read.
    let many: Vec<Value> = (0..=crate::report::model::MAX_IMAGES)
        .map(|n| image(&format!("{n:064x}"), "", "half"))
        .collect();
    assert_eq!(
        book.write(&handover(many)).unwrap_err().to_string(),
        "A report holds at most 400 photos; this one has 401."
    );
    // 2 001 placements of one photo.
    let placed: Vec<Value> = (0..=crate::report::model::MAX_IMAGE_PLACEMENTS)
        .map(|_| image(&book.png, "", "half"))
        .collect();
    assert_eq!(
        book.write(&handover(placed)).unwrap_err().to_string(),
        "A report places photos at most 2000 times; this one places them 2001 times."
    );
    // 2 000 placements of three photos are written, each embedded once.
    let placed: Vec<Value> = (0..crate::report::model::MAX_IMAGE_PLACEMENTS)
        .map(|n| image([&book.png, &book.wiring, &book.floor][n % 3], "", "half"))
        .collect();
    let reading = read(&book.write(&handover(placed)).unwrap());
    assert_eq!(
        (reading.images.len(), reading.placements),
        (3, crate::report::model::MAX_IMAGE_PLACEMENTS)
    );

    // The data: 150 MiB, counted over distinct photos, refused as soon as it
    // is passed — measured here against a cap just under these three.
    assert_eq!(MAX_IMAGE_BYTES, 150 * 1024 * 1024);
    let document = handover(vec![
        image(&book.png, "", "full"),
        image(&book.wiring, "", "full"),
        image(&book.png, "", "full"),
        image(&book.floor, "", "full"),
    ]);
    let total = with_work(&book.open, |state| {
        images::resolve(&state.conn, &state.folder, &document.blocks)
    })
    .unwrap()
    .values()
    .map(|i| i.jpeg.len())
    .sum::<usize>();
    let refused = with_work(&book.open, |state| {
        images::resolve_within(&state.conn, &state.folder, &document.blocks, total - 1)
    })
    .unwrap_err();
    assert_eq!(refused.to_string(), TOO_MUCH_IMAGE_DATA);
    with_work(&book.open, |state| {
        images::resolve_within(&state.conn, &state.folder, &document.blocks, total)
    })
    .expect("the cap itself is accepted; the repeated photo is counted once");
    work_close_with(&book.open);
}

/// A document with a photo needs the work open; one without still does not.
#[test]
fn a_document_with_a_photo_needs_the_work_open() {
    let book = a_book();
    let document = handover(vec![image(&book.png, "Pipes", "full")]);
    work_close_with(&book.open);
    let path = book.out.path().join("handover.pdf");
    let refused = report_pdf_write_with(
        &book.open,
        &Written::default(),
        &path.to_string_lossy(),
        &document,
        false,
        CREATED_AT,
    )
    .unwrap_err();
    assert_eq!(refused.kind(), "no_work_open");
    assert!(files_in(book.out.path()).is_empty());
    let words = handover(vec![json!({ "type": "paragraph", "text": "No photo." })]);
    report_pdf_write_with(
        &OpenWork::default(),
        &Written::default(),
        &path.to_string_lossy(),
        &words,
        false,
        CREATED_AT,
    )
    .expect("no photo, no work needed");
}

/// The diary's own export may carry its photos too, found the same way.
#[test]
fn the_diary_export_embeds_a_diary_photo_by_its_hash() {
    let (_db, open, _work) = host_with_a_work();
    let source = Scratch::create();
    let photo = source.path().join("site.png");
    let bytes = png(200, 100);
    std::fs::write(&photo, &bytes).unwrap();
    let draft: EntryDraft = serde_json::from_value(json!({
        "day": "2026-10-05", "kind": "entry", "note": "Pipes in.",
        "photoPaths": [photo.to_string_lossy()]
    }))
    .unwrap();
    diary_entry_add_with(&open, &draft, today(), AUTHOR).unwrap();
    assert_eq!(work_get_with(&open).unwrap().documents.len(), 1);
    let hash = intake::sha256_hex(&bytes);
    let document: ReportDocument = serde_json::from_value(json!({
        "kind": "diary", "title": "Diary", "subtitle": "", "pageSize": "a4", "language": "en",
        "blocks": [
            { "type": "paragraph", "text": "#1 · 2026-10-05 · Pipes in." },
            image(&hash, "site.png", "half")
        ]
    }))
    .unwrap();
    let out = Scratch::create();
    let path = out.path().join("diary.pdf");
    diary_export_pdf_with(
        &open,
        &Written::default(),
        &path.to_string_lossy(),
        &document,
        false,
        CREATED_AT,
    )
    .unwrap();
    let reading = read(&std::fs::read(&path).unwrap());
    assert_eq!(reading.images.len(), 1);
    assert_eq!(
        (reading.images[0].width, reading.images[0].height),
        (200, 100)
    );
    assert!(reading.text().contains("Chain verified"));
    work_close_with(&open);
}
