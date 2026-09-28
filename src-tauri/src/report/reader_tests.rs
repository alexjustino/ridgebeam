//! The second reader (ADR-031): every PDF these tests write is parsed by
//! `lopdf` — a library of another lineage than `pdf-writer` — and its pages,
//! text and metadata read back. A PDF nobody parsed is a PDF nobody knows the
//! contents of.

use chrono::{DateTime, FixedOffset};
use lopdf::{Document, Object};

use crate::report::model::tests::every_block;
use crate::report::model::{Block, Language, PageSize, ReportDocument, Tone};
use crate::report::{render, verification, Verified};

/// What the second reader found in a PDF.
pub struct Reading {
    /// Each page's text, whitespace folded, one line per text line.
    pub pages: Vec<Vec<String>>,
    /// Each page's `/MediaBox` width and height.
    pub sizes: Vec<(f32, f32)>,
    /// The `/Info` dictionary's `/Title`.
    pub title: Option<String>,
    /// Its `/Producer`.
    pub producer: Option<String>,
    /// Its `/CreationDate`, as written.
    pub creation_date: Option<String>,
    /// Whether it has an `/Author`.
    pub has_author: bool,
    /// The fonts the pages use, by base name.
    pub fonts: Vec<String>,
}

impl Reading {
    /// All the text, pages joined.
    pub fn text(&self) -> String {
        self.pages
            .iter()
            .map(|lines| lines.join("\n"))
            .collect::<Vec<_>>()
            .join("\n")
    }
}

fn info_string(document: &Document, key: &[u8]) -> Option<String> {
    let info = document.trailer.get(b"Info").ok()?;
    let dictionary = match info {
        Object::Reference(id) => document.get_object(*id).ok()?.as_dict().ok()?,
        Object::Dictionary(dictionary) => dictionary,
        _ => return None,
    };
    let value = dictionary.get(key).ok()?;
    lopdf::decode_text_string(value).ok()
}

fn number(object: &Object) -> f32 {
    match object {
        Object::Integer(value) => *value as f32,
        Object::Real(value) => *value,
        other => panic!("not a number: {other:?}"),
    }
}

/// Parse `bytes` with the second reader.
pub fn read(bytes: &[u8]) -> Reading {
    assert!(bytes.starts_with(b"%PDF-"), "a PDF starts with %PDF-");
    assert!(
        bytes.trim_ascii_end().ends_with(b"%%EOF"),
        "a PDF ends with %%EOF"
    );
    let document = Document::load_mem(bytes).expect("the second reader parses the file");
    let mut pages = Vec::new();
    let mut sizes = Vec::new();
    let mut fonts = Vec::new();
    for (number_of_page, id) in document.get_pages() {
        let text = document
            .extract_text(&[number_of_page])
            .expect("the second reader extracts the page's text");
        pages.push(
            text.lines()
                .map(|line| line.split_whitespace().collect::<Vec<_>>().join(" "))
                .filter(|line| !line.is_empty())
                .collect(),
        );
        let page = document.get_dictionary(id).unwrap();
        let media = page.get(b"MediaBox").unwrap().as_array().unwrap();
        sizes.push((number(&media[2]), number(&media[3])));
        for (_, font) in document.get_page_fonts(id).unwrap() {
            let name = font.get(b"BaseFont").unwrap().as_name().unwrap();
            let name = String::from_utf8(name.to_vec()).unwrap();
            let encoding = font.get(b"Encoding").unwrap().as_name().unwrap();
            assert_eq!(encoding, b"WinAnsiEncoding", "{name}");
            assert!(font.get(b"FontFile").is_err() && font.get(b"FontDescriptor").is_err());
            if !fonts.contains(&name) {
                fonts.push(name);
            }
        }
    }
    Reading {
        pages,
        sizes,
        title: info_string(&document, b"Title"),
        producer: info_string(&document, b"Producer"),
        creation_date: info_string(&document, b"CreationDate"),
        has_author: info_string(&document, b"Author").is_some(),
        fonts,
    }
}

pub fn moment() -> DateTime<FixedOffset> {
    DateTime::parse_from_rfc3339("2026-10-09T14:05:30-03:00").unwrap()
}

fn written(document: &ReportDocument) -> Reading {
    let pdf = render(document, &[], &moment()).expect("render");
    let reading = read(&pdf.bytes);
    assert_eq!(reading.pages.len(), pdf.pages, "the page count it reports");
    reading
}

#[test]
fn every_block_type_is_read_back_by_a_second_reader_with_its_words() {
    let reading = written(&every_block());

    assert_eq!(reading.pages.len(), 2);
    let text = reading.text();
    for words in [
        "Weekly report — Synthetic bathroom",
        "Week of 5 October 2026",
        "This week on site",
        "Two entries were written this week.",
        "Nothing was written on Friday.",
        "Photos are not in this report.",
        "Readiness",
        "3 of 5",
        "• Tiles chosen",
        "• Plumber named",
        "Activity",
        "Days",
        "Tiling",
        "Grout",
        "Mon",
        "Fri",
        "After the break.",
    ] {
        assert!(text.contains(words), "{words:?} in {text}");
    }
    assert!(reading.pages[1].contains(&"After the break.".to_string()));
    assert!(reading.fonts.contains(&"Helvetica".to_string()));
    assert!(reading.fonts.contains(&"Helvetica-Bold".to_string()));
}

#[test]
fn the_metadata_is_the_title_the_producer_and_the_date_passed_in_and_no_author() {
    let reading = written(&every_block());
    assert_eq!(
        reading.title.as_deref(),
        Some("Weekly report — Synthetic bathroom")
    );
    assert_eq!(
        reading.producer,
        Some(format!("Ridgebeam {}", env!("CARGO_PKG_VERSION")))
    );
    assert_eq!(
        reading.creation_date.as_deref(),
        Some("D:20261009140530-03'00")
    );
    assert!(
        !reading.has_author,
        "no author: the file says nothing about who printed it"
    );
}

#[test]
fn the_same_document_and_date_write_the_same_bytes() {
    let one = render(&every_block(), &[], &moment()).unwrap();
    let two = render(&every_block(), &[], &moment()).unwrap();
    assert_eq!(one.bytes, two.bytes);
}

#[test]
fn both_page_sizes_are_read_back_as_a4() {
    let portrait = written(&every_block());
    for (width, height) in &portrait.sizes {
        assert!((width - 595.28).abs() < 0.05 && (height - 841.89).abs() < 0.05);
    }
    let landscape = written(&ReportDocument {
        page_size: PageSize::A4Landscape,
        ..every_block()
    });
    for (width, height) in &landscape.sizes {
        assert!(width > height, "landscape: wider than tall");
        assert!((width - 841.89).abs() < 0.05 && (height - 595.28).abs() < 0.05);
    }
}

#[test]
fn a_long_table_is_read_back_across_pages_with_its_header_and_page_n_of_m_on_every_one() {
    let rows: Vec<Vec<String>> = (1..=300)
        .map(|n| {
            vec![
                n.to_string(),
                format!("Activity number {n}"),
                format!("{n} d"),
            ]
        })
        .collect();
    let document: ReportDocument = serde_json::from_value(serde_json::json!({
        "kind": "schedule", "title": "Schedule", "subtitle": "", "pageSize": "a4-landscape",
        "language": "en",
        "blocks": [{ "type": "table", "columns": [
            { "text": "#", "align": "right", "width": 0.1 },
            { "text": "Activity", "align": "left", "width": 0.7 },
            { "text": "Duration", "align": "right", "width": 0.2 }
        ], "rows": rows }]
    }))
    .unwrap();
    let reading = written(&document);

    let count = reading.pages.len();
    assert!(count >= 5, "{count} pages");
    let mut numbers = Vec::new();
    for (index, lines) in reading.pages.iter().enumerate() {
        assert!(
            lines.contains(&"Duration".to_string()),
            "page {}: the header repeated",
            index + 1
        );
        assert!(
            lines.contains(&format!(
                "Ridgebeam · Schedule · page {} of {count}",
                index + 1
            )),
            "page {}: {lines:?}",
            index + 1
        );
        numbers.extend(
            lines
                .iter()
                .filter_map(|l| l.strip_prefix("Activity number "))
                .map(|n| n.parse::<usize>().unwrap()),
        );
    }
    assert_eq!(numbers, (1..=300).collect::<Vec<_>>());
}

#[test]
fn the_substitutes_are_read_back_as_their_stand_ins_and_the_rest_as_itself() {
    let document = ReportDocument {
        blocks: vec![Block::Paragraph {
            text: "Tiling → Grout; float ≥ 2 and ≤ 5; 3 × 4 m²; 10:00\u{202F}AM; \u{2212}3".into(),
            tone: Tone::Normal,
        }],
        ..every_block()
    };
    let text = written(&document).text();
    assert!(
        text.contains("Tiling -> Grout; float >= 2 and <= 5; 3 × 4 m²; 10:00 AM; -3"),
        "{text}"
    );
    assert!(!text.contains('?'));
}

#[test]
fn portuguese_text_is_read_back_with_its_accents_and_the_footer_in_portuguese() {
    let document: ReportDocument = serde_json::from_value(serde_json::json!({
        "kind": "weekly", "title": "Relatório semanal — Banheiro sintético",
        "subtitle": "Semana de 5 de outubro de 2026", "pageSize": "a4", "language": "pt-BR",
        "blocks": [
            { "type": "heading", "level": 1, "text": "Esta semana na obra" },
            { "type": "paragraph", "text": "Nenhuma entrada foi escrita nesta semana.", "tone": "strong" },
            { "type": "figure", "label": "Prontidão", "value": "3 de 5", "rows": ["Revestimento não escolhido", "Encanador não definido"] },
            { "type": "table", "columns": [
                { "text": "Atividade", "align": "left", "width": 0.7 },
                { "text": "Duração", "align": "right", "width": 0.3 }
            ], "rows": [["Instalação elétrica", "3 dias"], ["Açaí — pausa", "1 dia"]] },
            { "type": "paragraph", "text": "Pago: R$\u{A0}1.234,56 · “ação” … ’", "tone": "muted" }
        ]
    }))
    .unwrap();
    let reading = written(&document);
    let text = reading.text();
    for words in [
        "Relatório semanal — Banheiro sintético",
        "Semana de 5 de outubro de 2026",
        "Esta semana na obra",
        "Nenhuma entrada foi escrita nesta semana.",
        "Prontidão",
        "• Revestimento não escolhido",
        "Duração",
        "Instalação elétrica",
        "Açaí — pausa",
        "“ação” … ’",
        "Ridgebeam · Relatório semanal — Banheiro sintético · página 1 de 1",
    ] {
        assert!(text.contains(words), "{words:?} in {text}");
    }
    assert_eq!(
        reading.title.as_deref(),
        Some("Relatório semanal — Banheiro sintético")
    );
}

#[test]
fn a_schedule_is_read_back_with_its_bars_labels_and_day_header() {
    let document: ReportDocument = serde_json::from_value(serde_json::json!({
        "kind": "schedule", "title": "Schedule", "subtitle": "", "pageSize": "a4-landscape",
        "language": "en",
        "blocks": [{ "type": "gantt", "days": 10,
            "dayLabels": ["5 Oct", "", "", "", "", "12 Oct", "", "", "", ""],
            "rows": [
                { "label": "Demolition", "start": 0, "length": 2, "critical": true, "baselineStart": 0, "baselineLength": 2 },
                { "label": "Plumbing", "start": 2, "length": 3, "critical": false, "baselineStart": 1, "baselineLength": 3 }
            ] },
            { "type": "table", "columns": [
                { "text": "Activity", "align": "left", "width": 0.8 },
                { "text": "Float", "align": "right", "width": 0.2 }
            ], "rows": [["Demolition", "0"], ["Plumbing", "2"]] }]
    }))
    .unwrap();
    let reading = written(&document);
    let text = reading.text();
    for words in ["5 Oct", "12 Oct", "Demolition", "Plumbing", "Float"] {
        assert!(text.contains(words), "{words:?} in {text}");
    }
    let (width, height) = reading.sizes[0];
    assert!(width > height);
}

#[test]
fn the_diary_verification_block_is_read_back_in_english_and_in_portuguese() {
    let verified = Verified {
        entries: 3,
        head: Some("0123456789abcdef".repeat(4)),
    };
    let english = ReportDocument {
        kind: crate::report::model::ReportKind::Diary,
        title: "Diary".into(),
        ..every_block()
    };
    let pdf = render(
        &english,
        &verification(Language::En, &verified, &moment()),
        &moment(),
    )
    .unwrap();
    let lines = read(&pdf.bytes).pages[0].clone();
    assert_eq!(lines[0], "Diary");
    let at = lines
        .iter()
        .position(|l| l.starts_with("Chain verified"))
        .unwrap();
    assert_eq!(
        lines[at..at + 3],
        [
            "Chain verified on 2026-10-09: 3 entries, head 0123456789abcdef.",
            "This is tamper-evidence: it shows whether the file was changed outside Ridgebeam.",
            "It is not a signature and not legal proof."
        ]
    );
    assert!(
        at < lines.iter().position(|l| l == "This week on site").unwrap(),
        "in front of the document's own blocks"
    );

    let portuguese = ReportDocument {
        language: Language::PtBr,
        title: "Diário".into(),
        ..english
    };
    let pdf = render(
        &portuguese,
        &verification(
            Language::PtBr,
            &Verified {
                entries: 1,
                head: Some("fedcba9876543210".repeat(4)),
            },
            &moment(),
        ),
        &moment(),
    )
    .unwrap();
    let text = read(&pdf.bytes).text();
    for words in [
        "Cadeia verificada em 09/10/2026: 1 entrada, impressão digital da última fedcba9876543210.",
        "Isto é evidência de adulteração: mostra se o arquivo foi alterado fora do Ridgebeam.",
        "Não é uma assinatura e não é prova legal.",
    ] {
        assert!(text.contains(words), "{words:?} in {text}");
    }

    let empty = verification(
        Language::En,
        &Verified {
            entries: 0,
            head: None,
        },
        &moment(),
    );
    assert!(
        matches!(&empty[0], Block::Paragraph { text, tone: Tone::Strong } if text == "Chain verified on 2026-10-09: 0 entries.")
    );
}

/// The words the product's dictionaries hold reach the page as themselves:
/// every character of every string of the glossary, and of every line of the
/// two dictionaries that is not a comment, is printed without a `?`. (The
/// interface's own test composes every report in both languages; this is the
/// host's side of the same promise, over the files as they are.)
#[test]
fn every_character_the_dictionaries_hold_prints_without_a_question_mark() {
    use crate::report::winansi::encode;
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../src/i18n");
    let mut checked = 0;
    for name in ["en.ts", "pt-BR.ts", "glossary.json"] {
        let Ok(text) = std::fs::read_to_string(root.join(name)) else {
            continue;
        };
        for (number, line) in text.lines().enumerate() {
            let trimmed = line.trim_start();
            if trimmed.starts_with("//") || trimmed.starts_with("/*") || trimmed.starts_with('*') {
                continue;
            }
            let without_question_marks = line.replace('?', "");
            let bytes = encode(&without_question_marks);
            assert!(
                !bytes.contains(&b'?'),
                "{name}:{}: {line:?} has a character the page cannot print",
                number + 1
            );
            checked += 1;
        }
    }
    assert!(checked > 0, "the dictionaries were found");
}
