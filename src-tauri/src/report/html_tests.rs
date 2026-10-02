//! The snapshot's page, pure: every block rendered, every string escaped in
//! every field, the head the page must carry, a photo re-encoded and embedded
//! as a JPEG data address, the schedule as well-formed SVG, and the verifier
//! refusing every forbidden pattern put into a rendered page. Every string and
//! picture here is synthetic.

use chrono::DateTime;
use serde_json::{json, Value};

use super::*;
use crate::files::intake::tests::{jpeg, png};
use crate::report::images::tests::{header_markers, jpeg_with_metadata};
use crate::report::images::{self, jpeg_frame, prepare_with, Embedded};
use crate::report::model::{self, ReportKind};

const PHOTO: &str = "1111111111111111111111111111111111111111111111111111111111111111";
const WIDE: &str = "2222222222222222222222222222222222222222222222222222222222222222";

fn moment() -> DateTime<FixedOffset> {
    DateTime::parse_from_rfc3339("2026-10-09T14:05:30-03:00").unwrap()
}

/// A snapshot with one block of every type, in `language`, every string
/// field set to `words(name)`.
pub fn snapshot_with(language: &str, words: &dyn Fn(&str) -> String) -> ReportDocument {
    serde_json::from_value(json!({
        "kind": "snapshot",
        "title": words("The work today — Synthetic bathroom"),
        "subtitle": words("Friday 9 October"),
        "pageSize": "a4",
        "language": language,
        "blocks": [
            { "type": "heading", "level": 1, "text": words("Readiness") },
            { "type": "paragraph", "text": words("3 of 5 things are ready.\nTwo are not."), "tone": "strong" },
            { "type": "paragraph", "text": words("Plain words.") },
            { "type": "paragraph", "text": words("Quiet words."), "tone": "muted" },
            { "type": "heading", "level": 2, "text": words("The next two weeks") },
            { "type": "figure", "label": words("Starting"), "value": words("2 activities"),
              "rows": [words("Tiling — Monday 12 Oct"), words("Grout — Friday 16 Oct")] },
            { "type": "figure", "label": words("Payments due"), "value": words("none"), "rows": [] },
            { "type": "rule" },
            { "type": "table",
              "columns": [
                { "text": words("Money"), "align": "left", "width": 0.6 },
                { "text": words("Amount"), "align": "right", "width": 0.4 }
              ],
              "rows": [[words("Planned"), words("R$ 10.000,00")], [words("Paid"), words("R$ 4.000,00")]] },
            { "type": "gantt", "days": 5,
              "dayLabels": [words("Mon"), words("Tue"), words("Wed"), words("Thu"), words("Fri")],
              "rows": [
                { "label": words("Tiling"), "start": 0, "length": 4, "critical": true,
                  "baselineStart": 0, "baselineLength": 3 },
                { "label": words("Grout"), "start": 4, "length": 0, "critical": false,
                  "baselineStart": null, "baselineLength": null }
              ] },
            { "type": "pageBreak" },
            { "type": "image", "hash": PHOTO, "caption": words("Pipes before the wall"), "size": "full" },
            { "type": "image", "hash": PHOTO, "caption": words("Again, half"), "size": "half" },
            { "type": "image", "hash": WIDE, "caption": "", "size": "half" },
            { "type": "paragraph", "text": words("Written by Ridgebeam on 9 October. A snapshot.") }
        ]
    }))
    .expect("the wire shape the interface sends")
}

fn plain(text: &str) -> String {
    text.to_string()
}

/// The two photos the documents above name, prepared as a snapshot prepares
/// them.
fn photos() -> Images {
    let mut images = Images::new();
    images.insert(PHOTO.into(), prepare_with(&png(300, 200), &SENT).unwrap());
    images.insert(
        WIDE.into(),
        prepare_with(&jpeg_with_metadata(2000, 1000).0, &SENT).unwrap(),
    );
    images
}

fn page(document: &ReportDocument) -> String {
    model::check(document).expect("inside every limit");
    check(document).expect("inside the snapshot's limits");
    let page = render(document, &photos(), &moment()).expect("rendered");
    verify(&page).expect("the renderer's own page verifies");
    page
}

/// The page's text as a reader sees it: the character references this
/// renderer writes read back.
fn unescape(text: &str) -> String {
    let mut out = String::new();
    let mut rest = text;
    while let Some(at) = rest.find('&') {
        out.push_str(&rest[..at]);
        rest = &rest[at..];
        let end = rest.find(';').expect("a reference ends");
        let name = &rest[1..end];
        match name {
            "amp" => out.push('&'),
            "lt" => out.push('<'),
            "gt" => out.push('>'),
            "quot" => out.push('"'),
            number if number.starts_with('#') => {
                let code: u32 = number[1..].parse().expect("a decimal reference");
                out.push(char::from_u32(code).unwrap());
            }
            other => panic!("an unknown reference &{other};"),
        }
        rest = &rest[end + 1..];
    }
    out.push_str(rest);
    out
}

#[test]
fn every_block_renders_and_the_page_carries_its_head() {
    let document = snapshot_with("en", &plain);
    assert_eq!(document.kind, ReportKind::Snapshot);
    let page = page(&document);

    // The head, in order: the doctype, the language, the charset first, the
    // policy before anything it governs.
    assert!(page.starts_with("<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; img-src data:; style-src 'unsafe-inline'\">\n"), "{}", &page[..400]);
    assert_eq!(
        CSP,
        "default-src 'none'; img-src data:; style-src 'unsafe-inline'"
    );
    for needle in [
        "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">",
        "<meta name=\"color-scheme\" content=\"light dark\">",
        "<meta name=\"referrer\" content=\"no-referrer\">",
        "<title>The work today — Synthetic bathroom</title>",
        "<h1>The work today — Synthetic bathroom</h1>",
        "<p class=\"subtitle\">Friday 9 October</p>",
        // Headings under the page's own title.
        "<h2>Readiness</h2>",
        "<h3>The next two weeks</h3>",
        // Tones, and a line break kept.
        "<p class=\"strong\">3 of 5 things are ready.<br>Two are not.</p>",
        "<p>Plain words.</p>",
        "<p class=\"muted\">Quiet words.</p>",
        // A figure opens onto its rows; one with no rows does not open.
        "<details>\n<summary><span class=\"label\">Starting</span> — <span class=\"value\">2 activities</span></summary>\n<ul>\n<li>Tiling — Monday 12 Oct</li>\n<li>Grout — Friday 16 Oct</li>\n</ul>\n</details>",
        "<div class=\"figure\"><span class=\"label\">Payments due</span> — <span class=\"value\">none</span></div>",
        "<hr>",
        // A table inside a region that scrolls sideways; numbers to the right.
        "<div class=\"scroll\" tabindex=\"0\">\n<table>",
        "<th>Money</th><th class=\"r\">Amount</th>",
        "<td>Planned</td><td class=\"r\">R$ 10.000,00</td>",
        // The schedule: an inline SVG, a title per bar.
        "<figure class=\"gantt\">\n<svg width=\"100%\" height=\"106\">",
        "<title>Tiling · Mon – Thu</title>",
        "<title>Grout · Fri</title>",
        "<text class=\"lbl\" x=\"2\" y=\"37\">Tiling</text>",
        // A full photo with its caption; two halves side by side.
        "<figure>\n<img src=\"data:image/jpeg;base64,",
        "\" alt=\"Pipes before the wall\" width=\"300\" height=\"200\">\n<figcaption>Pipes before the wall</figcaption>",
        "<div class=\"pair\">\n<figure>",
        "\" alt=\"Photo\" width=\"1024\" height=\"512\">\n</figure>\n</div>",
        "<p>Written by Ridgebeam on 9 October. A snapshot.</p>\n</main>\n</body>\n</html>\n",
    ] {
        assert!(page.contains(needle), "{needle:?} not in the page");
    }
    // The moment the page was made, escaped as every attribute is.
    assert!(page.contains(
        "<meta name=\"dcterms.created\" content=\"2026-10-09T14&#58;05&#58;30-03&#58;00\">"
    ));
    // The style: one column, the system's fonts, light and dark, print.
    for needle in [
        "max-width:42rem",
        "system-ui",
        "@media (prefers-color-scheme:dark)",
        "--bg:#fafafa",
        "--accent:#005fb8",
        "--bg:#202020",
        "--accent:#60cdff",
        "min-height:2.75rem",
        "@media print",
        "overflow-x:auto",
    ] {
        assert!(STYLE.contains(needle), "{needle:?} in the style");
    }
    assert_eq!(page.matches("<style>").count(), 1);
    assert_eq!(page.matches("<details>").count(), 1);
    assert_eq!(page.matches("<img ").count(), 3, "each placement embedded");
    assert!(!page.contains("pageBreak") && !page.contains("page-break"));

    // Portuguese: the page says so, and a photo without a caption is a "Foto".
    let portuguese = page_in("pt-BR");
    assert!(portuguese.starts_with("<!DOCTYPE html>\n<html lang=\"pt-BR\">"));
    assert!(portuguese.contains("alt=\"Foto\""));
}

fn page_in(language: &str) -> String {
    page(&snapshot_with(language, &plain))
}

/// Strings a hostile file, a pasted note or a careless name could carry.
const HOSTILE: &[&str] = &[
    "<script>alert(1)</script>",
    "</script><script src=https://evil.example/x.js></script>",
    "\" onmouseover=\"alert(1)",
    "' onfocus='alert(1)' x='",
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    "<img src=x onerror=alert(1)>",
    "<a href=\"http://evil.example\">click</a>",
    "//evil.example/track.gif",
    "url(https://evil.example/x.png)",
    "@import 'https://evil.example/x.css';",
    "</style><style>body{background:url(//x)}</style>",
    "<!-- a comment --> & &amp; < >",
    "data:text/html;base64,PHNjcmlwdD4=",
    "<iframe src=//x></iframe><object></object><embed><link rel=stylesheet><base href=//x>",
    "<svg onload=alert(1)><foreignObject></foreignObject></svg>",
    "x=`y`",
];

#[test]
fn hostile_strings_in_every_field_survive_as_text_never_as_markup() {
    let all = HOSTILE.join(" ");
    let with_controls = format!("{all}\u{0}\u{7}\r\u{1b}\u{7f}\u{85}");
    let document = snapshot_with("en", &|name: &str| format!("{name} {with_controls}"));
    let page = page(&document);
    let lower = page.to_ascii_lowercase();

    for markup in [
        "<script",
        "</script",
        "onmouseover=",
        "onfocus=",
        "onerror=",
        "onload=",
        "javascript:",
        "http:",
        "https:",
        "<img src=x",
        "<a ",
        "<iframe",
        "<object",
        "<embed",
        "<link",
        "<base",
        "@import",
        "url(",
        "<!--",
        "</style><style>",
        "<foreignobject",
        "data:text",
        "`",
    ] {
        assert!(!lower.contains(markup), "{markup:?} survived as markup");
    }
    assert_eq!(page.matches("<style>").count(), 1);
    assert_eq!(page.matches("</style>").count(), 1);
    assert_eq!(lower.matches("<svg").count(), 1, "only the schedule's own");
    assert_eq!(lower.matches("<img ").count(), 3, "only the photos");
    for control in ['\u{0}', '\u{7}', '\r', '\u{1b}', '\u{7f}', '\u{85}'] {
        assert!(!page.contains(control), "{control:?} dropped");
    }

    // Each string reads back whole as text, in every field it went into.
    let text = unescape(&page);
    for field in [
        "The work today — Synthetic bathroom",
        "Friday 9 October",
        "Readiness",
        "The next two weeks",
        "Plain words.",
        "Quiet words.",
        "Starting",
        "2 activities",
        "Tiling — Monday 12 Oct",
        "Payments due",
        "Money",
        "Amount",
        "R$ 10.000,00",
        "Pipes before the wall",
        "Again, half",
        "Written by Ridgebeam on 9 October. A snapshot.",
    ] {
        assert!(
            text.contains(&format!("{field} {all}")),
            "{field} with every hostile string, as text"
        );
    }
    // The schedule's text: a bar's whole label in its title, the day labels
    // in it and on the axis, clipped.
    assert!(text.contains(&format!(
        "<title>Tiling {all} · Mon {all} – Thu {all}</title>"
    )));
    assert!(text.contains(&format!("<title>Grout {all} · Fri {all}</title>")));
    // The photo's alternative text, an attribute, as text too.
    assert!(text.contains(&format!("alt=\"Pipes before the wall {all}\"")));
}

#[test]
fn escape_writes_references_that_read_the_same() {
    assert_eq!(
        escape("a<b>&\"'/:=@(`c"),
        "a&lt;b&gt;&amp;&quot;&#39;&#47;&#58;&#61;&#64;&#40;&#96;c"
    );
    assert_eq!(escape("line\nbreak\ttab"), "line\nbreak\ttab");
    assert_eq!(escape("\u{0}\u{8}\r\u{9b}é — ✓"), "é — ✓");
    for hostile in HOSTILE {
        assert_eq!(unescape(&escape(hostile)), *hostile);
        let escaped = escape(hostile);
        assert!(!escaped.contains(['<', '>', '"', '\'', '/', ':', '=', '(', '@', '`']));
    }
    assert_eq!(lines("one\ntwo"), "one<br>two");
    assert_eq!(line("one\ntwo"), "one two");
}

#[test]
fn a_photo_is_always_re_encoded_within_1024_px_and_embedded_without_its_metadata() {
    // A small JPEG with a phone's metadata — one that D3 would pass through —
    // and one past 1 024 px: both decoded and encoded again.
    let (small_with, small_clean) = jpeg_with_metadata(640, 480);
    let (large_with, _) = jpeg_with_metadata(2400, 1800);
    for (bytes, expected) in [
        (&small_with, (640, 480)),
        (&large_with, (1024, 768)),
        (&jpeg(800, 1600), (512, 1024)),
        (&png(1200, 900), (1024, 768)),
    ] {
        let embedded: Embedded = prepare_with(bytes, &SENT).unwrap();
        assert!(!embedded.passed_through, "always re-encoded");
        assert_eq!((embedded.width, embedded.height), expected);
        assert_ne!(embedded.jpeg, small_clean);
        assert_ne!(&embedded.jpeg, bytes);
    }
    // The page's own bytes: the data address decodes to a JPEG within 1 024
    // px, with no APP1 (EXIF, XMP) and no other metadata segment.
    let mut images = Images::new();
    images.insert(PHOTO.into(), prepare_with(&small_with, &SENT).unwrap());
    images.insert(WIDE.into(), prepare_with(&large_with, &SENT).unwrap());
    let document = snapshot_with("en", &plain);
    let page = render(&document, &images, &moment()).unwrap();
    verify(&page).unwrap();
    let mut found = 0;
    for part in page.split("src=\"data:image/jpeg;base64,").skip(1) {
        let encoded = &part[..part.find('"').unwrap()];
        let jpeg = base64::engine::general_purpose::STANDARD
            .decode(encoded)
            .expect("base64");
        let frame = jpeg_frame(&jpeg).expect("a JPEG");
        assert!(frame.width.max(frame.height) <= 1024, "{frame:?}");
        let markers = header_markers(&jpeg);
        for metadata in [0xE1, 0xE2, 0xED, 0xFE] {
            assert!(!markers.contains(&metadata), "{metadata:#x}: {markers:x?}");
        }
        assert!(!jpeg.windows(4).any(|w| w == b"Exif"));
        assert!(!jpeg.windows(6).any(|w| w == b"serial"));
        found += 1;
    }
    assert_eq!(found, 3);
    assert_eq!(
        (SENT.max_side, SENT.quality, SENT.pass_through),
        (1024, 78, false)
    );
    assert_eq!(
        images::PRINTED.max_side,
        1600,
        "the PDF's setting unchanged"
    );
}

#[test]
fn a_document_with_no_photo_renders_and_verifies() {
    let document: ReportDocument = serde_json::from_value(json!({
        "kind": "snapshot", "title": "The work today", "subtitle": "", "pageSize": "a4",
        "language": "en",
        "blocks": [{ "type": "paragraph", "text": "Nothing to show yet." }]
    }))
    .unwrap();
    let page = render(&document, &Images::new(), &moment()).unwrap();
    verify(&page).unwrap();
    assert!(!page.contains("<img"));
    assert!(
        !page.contains("<p class=\"subtitle\">"),
        "an empty subtitle is left out"
    );
    assert!(page.contains("<p>Nothing to show yet.</p>"));
    assert_eq!(embedded_bytes(&document, &Images::new()), 0);
}

#[test]
fn an_image_that_was_not_prepared_is_a_bug_said_as_such() {
    let document = snapshot_with("en", &plain);
    let refused = render(&document, &Images::new(), &moment()).unwrap_err();
    assert_eq!(refused.kind(), "invalid_input");
    assert!(refused.to_string().contains("This is a bug in Ridgebeam"));
}

#[test]
fn the_caps_on_photos_and_their_data_are_refused_with_sentences() {
    let image = |n: usize| json!({ "type": "image", "hash": format!("{n:064x}"), "caption": "", "size": "half" });
    let with = |count: usize, same: bool| -> ReportDocument {
        serde_json::from_value(json!({
            "kind": "snapshot", "title": "The work today", "subtitle": "", "pageSize": "a4",
            "language": "en",
            "blocks": (0..count).map(|n| image(if same { 1 } else { n })).collect::<Vec<Value>>()
        }))
        .unwrap()
    };
    check(&with(MAX_IMAGES, false)).expect("60 photos");
    let refused = check(&with(MAX_IMAGES + 1, false)).unwrap_err();
    assert_eq!(
        refused.to_string(),
        "A snapshot holds at most 60 photos; this one places 61."
    );
    // The same photo placed again is embedded again, so it counts again.
    assert!(check(&with(MAX_IMAGES + 1, true)).is_err());

    // The data, counted where it is placed.
    let mut images = Images::new();
    images.insert(
        format!("{:064x}", 1),
        prepare_with(&png(64, 48), &SENT).unwrap(),
    );
    let three = with(3, true);
    let each = images.values().next().unwrap().jpeg.len();
    assert_eq!(embedded_bytes(&three, &images), 3 * each);
    check_image_data_within(&three, &images, 3 * each).expect("the cap itself");
    let refused = check_image_data_within(&three, &images, 3 * each - 1).unwrap_err();
    assert_eq!(refused.to_string(), TOO_MUCH_IMAGE_DATA);
    assert_eq!(
        TOO_MUCH_IMAGE_DATA,
        "The photos of this snapshot come to more than 8 MiB; a snapshot holds at most 8 MiB of photos."
    );
    assert_eq!(MAX_IMAGE_BYTES, 8 * 1024 * 1024);
    assert_eq!(MAX_FILE_BYTES, 12 * 1024 * 1024);
    check_image_data(&three, &images).expect("far under 8 MiB");
}

/// A small well-formedness check for an XML fragment: every tag closed in
/// order or self-closed, every attribute double-quoted and unique, every `&`
/// a reference, no `<` or `>` in text, one root.
fn well_formed(xml: &str) -> std::result::Result<usize, String> {
    let mut stack: Vec<String> = Vec::new();
    let mut roots = 0;
    let mut elements = 0;
    let mut rest = xml.trim();
    let text_ok = |text: &str| -> std::result::Result<(), String> {
        if text.contains('>') {
            return Err(format!("a > in text: {text:?}"));
        }
        let mut tail = text;
        while let Some(at) = tail.find('&') {
            let end = tail[at..].find(';').ok_or("an & that is not a reference")?;
            let name = &tail[at + 1..at + end];
            let known = matches!(name, "amp" | "lt" | "gt" | "quot" | "apos")
                || (name.starts_with('#') && name[1..].chars().all(|c| c.is_ascii_digit()));
            if !known {
                return Err(format!("an unknown reference &{name};"));
            }
            tail = &tail[at + end + 1..];
        }
        Ok(())
    };
    while !rest.is_empty() {
        let Some(at) = rest.find('<') else {
            text_ok(rest)?;
            break;
        };
        text_ok(&rest[..at])?;
        if stack.is_empty() && !rest[..at].trim().is_empty() {
            return Err("text outside the root".into());
        }
        let end = rest[at..].find('>').ok_or("a tag that does not end")? + at;
        let tag = &rest[at + 1..end];
        rest = &rest[end + 1..];
        if let Some(name) = tag.strip_prefix('/') {
            let open = stack.pop().ok_or("a close with nothing open")?;
            if open != name.trim() {
                return Err(format!("</{name}> closes <{open}>"));
            }
            continue;
        }
        let self_closing = tag.ends_with('/');
        let tag = tag.trim_end_matches('/').trim_end();
        let name_end = tag.find(char::is_whitespace).unwrap_or(tag.len());
        let name = &tag[..name_end];
        if name.is_empty() || !name.chars().all(|c| c.is_ascii_alphanumeric()) {
            return Err(format!("a bad name {name:?}"));
        }
        let mut attributes = tag[name_end..].trim();
        let mut seen = Vec::new();
        while !attributes.is_empty() {
            let eq = attributes.find("=\"").ok_or("an attribute without =\"")?;
            let attribute = attributes[..eq].trim();
            if attribute.is_empty() || seen.contains(&attribute) {
                return Err(format!("a bad or repeated attribute {attribute:?}"));
            }
            seen.push(attribute);
            let value_end = attributes[eq + 2..].find('"').ok_or("an unquoted value")? + eq + 2;
            let value = &attributes[eq + 2..value_end];
            if value.contains('<') {
                return Err("a < in a value".into());
            }
            text_ok(value)?;
            attributes = attributes[value_end + 1..].trim_start();
        }
        elements += 1;
        if stack.is_empty() {
            roots += 1;
        }
        if !self_closing {
            stack.push(name.to_string());
        }
    }
    if !stack.is_empty() {
        return Err(format!("left open: {stack:?}"));
    }
    if roots != 1 {
        return Err(format!("{roots} roots"));
    }
    Ok(elements)
}

#[test]
fn the_schedule_is_a_well_formed_svg_with_text_and_a_title_per_bar() {
    let all = HOSTILE.join(" ");
    let document = snapshot_with("en", &|name: &str| format!("{name} {all}"));
    let Block::Gantt {
        days,
        day_labels,
        rows,
    } = &document.blocks[9]
    else {
        panic!("the schedule");
    };
    let svg = gantt_svg(*days, day_labels, rows);
    let elements = well_formed(&svg).unwrap_or_else(|why| panic!("{why}\n{svg}"));
    assert!(elements > 10);
    assert!(svg.starts_with("<svg width=\"100%\" height=\""));
    assert!(!svg.contains("xmlns"), "no namespace address");
    assert_eq!(
        svg.matches("<rect class=\"bar").count(),
        2,
        "one bar per row"
    );
    assert_eq!(svg.matches("<title>").count(), 2, "a title per bar");
    assert_eq!(svg.matches("<text class=\"lbl\"").count(), 2);
    assert_eq!(svg.matches("<rect class=\"base\"").count(), 1);
    assert!(svg.contains("<rect class=\"bar\" x=\"0%\" y=\"43\" width=\"80%\""));
    assert!(
        svg.contains("<rect class=\"bar open\" x=\"80%\" y=\"83\" width=\"3\""),
        "a milestone is a mark"
    );
    assert!(svg.contains("<rect class=\"base\" x=\"0%\" y=\"57\" width=\"60%\""));
    assert!(svg.contains("class=\"bar open\""), "off the critical path");

    // The PDF's other shapes: no day labels, a baseline outside the days, a
    // milestone on the last day, ten years of days.
    for (days, labels, bars) in [
        (
            10,
            vec![],
            vec![(0, 10, Some(-3), Some(20)), (9, 0, None, None)],
        ),
        (
            3660,
            vec![String::from("d"); 3660],
            vec![(100, 3000, Some(0), Some(0))],
        ),
        (1, vec![String::from("Today")], vec![]),
    ] {
        let rows: Vec<GanttRow> = bars
            .into_iter()
            .map(
                |(start, length, baseline_start, baseline_length)| GanttRow {
                    label: "A <b>bar</b> & more".into(),
                    start,
                    length,
                    critical: start % 2 == 0,
                    baseline_start,
                    baseline_length,
                },
            )
            .collect();
        let svg = gantt_svg(days, &labels, &rows);
        well_formed(&svg).unwrap_or_else(|why| panic!("{days} days: {why}"));
        assert_eq!(svg.matches("<title>").count(), rows.len());
    }
    // A label longer than a line is clipped as text and whole in its title.
    let long = "x".repeat(200);
    let svg = gantt_svg(
        5,
        &[],
        &[GanttRow {
            label: long.clone(),
            start: 0,
            length: 2,
            critical: true,
            baseline_start: None,
            baseline_length: None,
        }],
    );
    assert!(svg.contains(&format!(">{}…</text>", "x".repeat(71))));
    assert!(svg.contains(&format!("<title>{long}</title>")));
}

/// Put `injected` into a page the renderer made, after it rendered — the
/// verifier must refuse what escaping would never let through.
fn tampered(injected: &str, before: &str) -> String {
    let page = page(&snapshot_with("en", &plain));
    let at = page.find(before).expect("a place to inject");
    format!("{}{injected}{}", &page[..at], &page[at..])
}

#[test]
fn the_verifier_refuses_every_forbidden_pattern_put_into_a_rendered_page() {
    let cases: &[(&str, &str, &str)] = &[
        ("<script>alert(1)</script>", "</main>", "a script"),
        ("<SCRIPT SRC=\"x\"></SCRIPT>", "</main>", "a script"),
        (
            "<p onclick=\"x\">a</p>",
            "</main>",
            "an event handler (onclick=)",
        ),
        (
            "<p ONMOUSEOVER = \"x\">a</p>",
            "</main>",
            "an event handler (onmouseover=)",
        ),
        (
            "<p>javascript:alert(1)</p>",
            "</main>",
            "a javascript: address",
        ),
        ("<p>http:x</p>", "</main>", "an http: address"),
        ("<p>see HTTPS:x</p>", "</main>", "an https: address"),
        ("<p>a //x</p>", "</main>", "an address on the network (//)"),
        ("<iframe></iframe>", "</main>", "an iframe"),
        ("<object></object>", "</main>", "an object"),
        ("<embed>", "</main>", "an embed"),
        ("<link>", "</head>", "a link to another file"),
        ("<base>", "</head>", "a base address"),
        ("<form></form>", "</main>", "a form"),
        ("@import 'x';", "</style>", "a CSS import"),
        ("body{background:url(x)}", "</style>", "a CSS url()"),
        (
            "<p>data:text/html</p>",
            "</main>",
            "a data: address that is not a JPEG photo",
        ),
        ("<!-- x -->", "</main>", "a comment"),
        (
            "<img src=\"x.png\">",
            "</main>",
            "an image that is not a JPEG written into the page",
        ),
        (
            "<img src=\"data:image/png;base64,AAAA\">",
            "</main>",
            "a data: address that is not a JPEG photo",
        ),
        (
            "<img src=\"data:image/jpeg;base64,AA!A\">",
            "</main>",
            "a data: address that is not a JPEG photo",
        ),
        (
            "<marquee>x</marquee>",
            "</main>",
            "an element <marquee> it is not made of",
        ),
        (
            "<p style=\"color:red\">x</p>",
            "</main>",
            "an attribute style it does not use",
        ),
        (
            "<p class=x>y</p>",
            "</main>",
            "an attribute class without a quoted value",
        ),
        ("<p>a > b</p>", "</main>", "a > outside a tag"),
        ("<p>x</p>", "<!DOCTYPE", "no <!DOCTYPE html> at its start"),
        (
            "</p><b>x</b>",
            "</main>",
            "an element <b> it is not made of",
        ),
        ("<a>x</a>", "</main>", "an element <a> it is not made of"),
        (
            "<meta http-equiv=\"refresh\" content=\"0\">",
            "</head>",
            "an attribute http-equiv it does not use",
        ),
    ];
    for (injected, before, what) in cases {
        let page = tampered(injected, before);
        let refused = verify(&page).unwrap_err();
        assert_eq!(refused.kind(), "invalid_input", "{injected}");
        assert_eq!(
            refused.to_string(),
            format!("The snapshot was not written: the page Ridgebeam made holds {what}, which a snapshot never carries. This is a bug in Ridgebeam, not in the work."),
            "{injected}"
        );
    }

    // The policy: gone, doubled, or after what it governs.
    let page = page(&snapshot_with("en", &plain));
    let meta = format!("<meta http-equiv=\"Content-Security-Policy\" content=\"{CSP}\">");
    let none = page.replacen(&meta, "", 1);
    assert!(verify(&none)
        .unwrap_err()
        .to_string()
        .contains("no Content-Security-Policy"));
    let twice = page.replacen(&meta, &format!("{meta}{meta}"), 1);
    assert!(verify(&twice)
        .unwrap_err()
        .to_string()
        .contains("more than one"));
    let late = none.replacen("</head>", &format!("{meta}</head>"), 1);
    assert!(verify(&late)
        .unwrap_err()
        .to_string()
        .contains("after what it governs"));
    let weaker = page.replacen("default-src 'none'", "default-src *", 1);
    assert!(verify(&weaker).is_err());

    // Base64 inside a photo may hold "//" or "on…=": it is set aside, not read.
    let mut images = photos();
    images.get_mut(PHOTO).unwrap().jpeg = b"\xff\xff\xfe\xfb\xef\xbe".repeat(10);
    let page = render(&snapshot_with("en", &plain), &images, &moment()).unwrap();
    assert!(page.contains("//"), "the base64 does hold //");
    verify(&page).expect("a photo's own bytes are not markup");
}
