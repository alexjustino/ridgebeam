//! The owner's snapshot (D4) against a real work on disk: the page written
//! whole as `.html` through the one save path, its photos found by hash as
//! D3 finds them and re-encoded, everything it refuses — writing nothing —,
//! the verifier refusing a page tampered with after it was rendered, and the
//! page opened by `report_open`. Every name and file here is synthetic.

use std::path::Path;

use chrono::NaiveDate;
use serde_json::{json, Value};

use crate::commands::documents::document_add_with;
use crate::commands::reports::{
    report_html_write_after, report_html_write_with, report_open_with, report_pdf_write_with,
    Written, NOT_THE_SNAPSHOT,
};
use crate::commands::work::tests::host_with_a_work;
use crate::commands::work::work_close_with;
use crate::db::testing::Scratch;
use crate::db::Db;
use crate::files::intake::{self, tests::png};
use crate::folder::OpenWork;
use crate::report::html::{MAX_IMAGES, TOO_MUCH_IMAGE_DATA};
use crate::report::images::tests::{header_markers, jpeg_with_metadata};
use crate::report::images::{self, jpeg_frame};
use crate::report::model::ReportDocument;

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

/// A work holding two photos: a PNG, and a small JPEG with a phone's
/// metadata — one a PDF would carry byte for byte, and a snapshot never does.
struct Site {
    _db: Db,
    open: OpenWork,
    _work: Scratch,
    pipes: String,
    floor: String,
    out: Scratch,
}

fn a_site() -> Site {
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
    let (pipes_path, pipes) = put("pipes.png", &png(1800, 1200));
    let (floor_path, floor) = put("floor.jpg", &jpeg_with_metadata(640, 480).0);
    let added = document_add_with(
        &open,
        &[pipes_path, floor_path],
        "photo",
        None,
        today(),
        AUTHOR,
    )
    .unwrap();
    assert!(added.refused.is_empty());
    Site {
        _db: db,
        open,
        _work: work,
        pipes,
        floor,
        out: Scratch::create(),
    }
}

fn image(hash: &str, caption: &str, size: &str) -> Value {
    json!({ "type": "image", "hash": hash, "caption": caption, "size": size })
}

fn snapshot(language: &str, blocks: Vec<Value>) -> ReportDocument {
    serde_json::from_value(json!({
        "kind": "snapshot", "title": "The work today", "subtitle": "Synthetic bathroom — 9 October",
        "pageSize": "a4", "language": language, "blocks": blocks
    }))
    .expect("a document the interface could send")
}

impl Site {
    fn path(&self, name: &str) -> String {
        self.out.path().join(name).to_string_lossy().into_owned()
    }

    fn write(&self, document: &ReportDocument) -> crate::error::Result<String> {
        let path = self.path("snapshot.html");
        report_html_write_with(
            &self.open,
            &Written::default(),
            &path,
            document,
            true,
            CREATED_AT,
        )?;
        Ok(std::fs::read_to_string(&path).unwrap())
    }
}

#[test]
fn a_snapshot_is_written_whole_as_one_page_with_its_photos_re_encoded() {
    let site = a_site();
    let written = Written::default();
    let path = site.path("The work today.html");
    let document = snapshot(
        "en",
        vec![
            json!({ "type": "heading", "level": 1, "text": "Lately on site" }),
            json!({ "type": "paragraph", "text": "Monday 5 Oct — pipes in, wall closed." }),
            image(&site.pipes, "Pipes before the wall", "half"),
            image(&site.floor, "The finished floor", "half"),
            json!({ "type": "figure", "label": "Readiness", "value": "3 of 5",
                    "rows": ["Tiles chosen", "Plumber named"] }),
        ],
    );
    let file =
        report_html_write_with(&site.open, &written, &path, &document, false, CREATED_AT).unwrap();
    let page = std::fs::read_to_string(&path).unwrap();
    assert_eq!(file.path, path);
    assert_eq!(file.bytes, page.len() as u64);
    assert_eq!(file.pages, None);
    assert_eq!(
        serde_json::to_value(&file).unwrap(),
        json!({ "path": path, "bytes": page.len() })
    );
    assert_eq!(files_in(site.out.path()), vec!["The work today.html"]);

    assert!(page.starts_with("<!DOCTYPE html>\n<html lang=\"en\">"));
    assert!(
        page.contains("content=\"default-src 'none'; img-src data:; style-src 'unsafe-inline'\"")
    );
    assert!(!page.to_ascii_lowercase().contains("<script"));
    assert!(page.contains("<summary><span class=\"label\">Readiness</span>"));
    assert!(page.contains("Monday 5 Oct — pipes in, wall closed."));

    let mut sizes = Vec::new();
    for part in page.split("src=\"data:image/jpeg;base64,").skip(1) {
        use base64::Engine as _;
        let jpeg = base64::engine::general_purpose::STANDARD
            .decode(&part[..part.find('"').unwrap()])
            .unwrap();
        let frame = jpeg_frame(&jpeg).unwrap();
        sizes.push((frame.width, frame.height));
        assert!(!header_markers(&jpeg).contains(&0xE1), "no APP1");
        assert!(!jpeg.windows(4).any(|w| w == b"Exif"));
        assert!(!jpeg.windows(6).any(|w| w == b"serial"));
    }
    assert_eq!(sizes, vec![(1024, 683), (640, 480)]);

    // The page just written is one `report_open` opens.
    let mut opened = None;
    report_open_with(&written, &path, |file| {
        opened = Some(file.to_path_buf());
        Ok(())
    })
    .unwrap();
    assert_eq!(opened.as_deref(), Some(Path::new(&path)));

    // Portuguese.
    let page = site
        .write(&snapshot(
            "pt-BR",
            vec![json!({ "type": "heading", "level": 1, "text": "Os próximos 14 dias" })],
        ))
        .unwrap();
    assert!(page.starts_with("<!DOCTYPE html>\n<html lang=\"pt-BR\">"));
    assert!(page.contains("<h2>Os próximos 14 dias</h2>"));
    work_close_with(&site.open);
}

#[test]
fn a_snapshot_with_no_photo_needs_no_work_and_one_with_a_photo_does() {
    let out = Scratch::create();
    let path = out.path().join("snapshot.html");
    let words = snapshot(
        "en",
        vec![json!({ "type": "paragraph", "text": "Nothing to show yet." })],
    );
    let file = report_html_write_with(
        &OpenWork::default(),
        &Written::default(),
        &path.to_string_lossy(),
        &words,
        false,
        CREATED_AT,
    )
    .expect("no photo, no work needed");
    let page = std::fs::read_to_string(&path).unwrap();
    assert_eq!(file.bytes, page.len() as u64);
    assert!(!page.contains("<img"));

    let site = a_site();
    let document = snapshot("en", vec![image(&site.pipes, "Pipes", "full")]);
    work_close_with(&site.open);
    let refused = report_html_write_with(
        &site.open,
        &Written::default(),
        &site.path("snapshot.html"),
        &document,
        false,
        CREATED_AT,
    )
    .unwrap_err();
    assert_eq!(refused.kind(), "no_work_open");
    assert!(files_in(site.out.path()).is_empty());
}

#[test]
fn what_a_snapshot_cannot_be_is_refused_with_a_sentence_and_nothing_is_written() {
    let site = a_site();
    let words = snapshot("en", vec![json!({ "type": "paragraph", "text": "Words." })]);

    // Only an .html file, by its full path; an existing one only from the
    // save dialog.
    for (path, overwrite, sentence) in [
        (
            site.path("snapshot.pdf"),
            false,
            "“snapshot.pdf” was not saved: the owner's snapshot is a .html file.".to_string(),
        ),
        (
            "snapshot.html".to_string(),
            false,
            "A report is saved to a file chosen by its full path.".to_string(),
        ),
    ] {
        let refused = report_html_write_with(
            &site.open,
            &Written::default(),
            &path,
            &words,
            overwrite,
            CREATED_AT,
        )
        .unwrap_err();
        assert_eq!(refused.to_string(), sentence);
    }
    std::fs::write(site.path("kept.html"), "the person's own file").unwrap();
    let refused = report_html_write_with(
        &site.open,
        &Written::default(),
        &site.path("kept.html"),
        &words,
        false,
        CREATED_AT,
    )
    .unwrap_err();
    assert!(refused.to_string().contains("already there"));
    assert_eq!(
        std::fs::read_to_string(site.path("kept.html")).unwrap(),
        "the person's own file"
    );
    std::fs::remove_file(site.path("kept.html")).unwrap();

    // Only the snapshot is a page; the PDF writer still takes it.
    let weekly: ReportDocument = serde_json::from_value(json!({
        "kind": "weekly", "title": "Weekly", "subtitle": "", "pageSize": "a4", "language": "en",
        "blocks": []
    }))
    .unwrap();
    assert_eq!(
        site.write(&weekly).unwrap_err().to_string(),
        NOT_THE_SNAPSHOT
    );
    report_pdf_write_with(
        &site.open,
        &Written::default(),
        &site.path("snapshot.pdf"),
        &words,
        false,
        CREATED_AT,
    )
    .expect("a snapshot printed is a report like any other");
    std::fs::remove_file(site.path("snapshot.pdf")).unwrap();

    // A date that is not one; a photo that is not this work's.
    let refused = report_html_write_with(
        &site.open,
        &Written::default(),
        &site.path("snapshot.html"),
        &words,
        false,
        "yesterday",
    )
    .unwrap_err();
    assert!(refused
        .to_string()
        .starts_with("A report's date is a moment"));
    let stranger = snapshot("en", vec![image(&"ab".repeat(32), "", "full")]);
    assert_eq!(
        site.write(&stranger).unwrap_err().to_string(),
        "Block 1 is a photo that is not in this work."
    );

    // 61 photos — the same one placed again counts, for it is embedded again.
    let many: Vec<Value> = (0..=MAX_IMAGES)
        .map(|_| image(&site.pipes, "", "half"))
        .collect();
    assert_eq!(
        site.write(&snapshot("en", many)).unwrap_err().to_string(),
        "A snapshot holds at most 60 photos; this one places 61."
    );

    // The data cap, by the snapshot's own setting and sentence.
    let two = snapshot(
        "en",
        vec![
            image(&site.pipes, "", "full"),
            image(&site.floor, "", "full"),
        ],
    );
    let refused = crate::commands::work::with_work(&site.open, |state| {
        images::resolve_with(
            &state.conn,
            &state.folder,
            &two.blocks,
            &images::Setting {
                max_bytes: 1,
                ..crate::report::html::SENT
            },
        )
    })
    .unwrap_err();
    assert_eq!(refused.to_string(), TOO_MUCH_IMAGE_DATA);

    // A page over 12 MiB: words alone can make one, escaped.
    let paragraph = json!({ "type": "paragraph", "text": "<&>".repeat(666) });
    let huge = snapshot("en", vec![paragraph; 1600]);
    assert_eq!(
        site.write(&huge).unwrap_err().to_string(),
        "“snapshot.html” was not saved: it would be larger than 12 MiB; a snapshot is at most 12 MiB."
    );
    assert!(files_in(site.out.path()).is_empty(), "nothing written");
    work_close_with(&site.open);
}

/// The verifier runs on the page's own bytes before they are written: a page
/// tampered with after it was rendered — what a bug in the renderer would
/// make — is refused as a bug, and nothing is written.
#[test]
fn a_page_that_fails_its_verification_is_refused_as_a_bug_and_not_written() {
    let site = a_site();
    let document = snapshot(
        "en",
        vec![
            json!({ "type": "paragraph", "text": "Words." }),
            image(&site.pipes, "Pipes", "full"),
        ],
    );
    for injected in [
        "<script>alert(1)</script>",
        "<p onclick=\"x\">x</p>",
        "<img src=\"https://evil.example/x.png\">",
        "<link>",
        "<p>javascript:x</p>",
    ] {
        let refused = report_html_write_after(
            &site.open,
            &Written::default(),
            &site.path("snapshot.html"),
            &document,
            false,
            CREATED_AT,
            |page| *page = page.replacen("</main>", &format!("{injected}</main>"), 1),
        )
        .unwrap_err();
        assert_eq!(refused.kind(), "invalid_input");
        let sentence = refused.to_string();
        assert!(
            sentence.starts_with("The snapshot was not written: the page Ridgebeam made holds ")
                && sentence.ends_with("This is a bug in Ridgebeam, not in the work."),
            "{injected}: {sentence}"
        );
        assert!(files_in(site.out.path()).is_empty(), "{injected}");
    }
    // Untouched, the same document is written.
    report_html_write_after(
        &site.open,
        &Written::default(),
        &site.path("snapshot.html"),
        &document,
        false,
        CREATED_AT,
        |_| {},
    )
    .unwrap();
    assert_eq!(files_in(site.out.path()), vec!["snapshot.html"]);
    work_close_with(&site.open);
}
