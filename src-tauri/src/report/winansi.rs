//! Text as the page prints it: WinAnsiEncoding, and the widths of the two faces.
//!
//! A report is written in the standard Helvetica and Helvetica-Bold, which
//! every PDF reader carries, so nothing is embedded (ADR-031). They are used
//! with `/WinAnsiEncoding`: one byte per character, which covers the printable
//! ASCII, the Latin-1 supplement (U+00A0–U+00FF) and the 27 characters
//! Windows-1252 puts between 0x80 and 0x9F (€ ‚ ƒ „ … † ‡ ˆ ‰ Š ‹ Œ Ž ‘ ’ “ ” • – —
//! ˜ ™ š › œ ž Ÿ). That is Portuguese and English as the product writes them:
//! á ã â à ç é ê í ó õ ô ú ü, – — … • ‘ ’ “ ” € ° ² ³ º ª · ×.
//!
//! # Outside the set
//!
//! Three characters the product writes are outside it, and are printed as
//! documented stand-ins ([`SUBSTITUTES`]): `→` as `->`, `≥` as `>=`, `≤` as `<=`.
//! `×` (U+00D7) is inside the set and prints as itself. What `Intl` writes into
//! dates and numbers is folded onto what the faces carry, as the interface's
//! `printable` folds it: every Unicode space (the narrow no-break space before
//! "AM", the thin space, the figure space) is a space; U+2212 minus and the two
//! Unicode hyphens are `-`; zero-width characters are dropped. A tab is a space;
//! a line break is kept, and the layout breaks the line there. Anything else is
//! printed as `?` — and the interface's tests compose every report in both
//! languages and fail on a character that would be.
//!
//! # The widths
//!
//! [`HELVETICA`] and [`HELVETICA_BOLD`] give the advance width of every WinAnsi
//! code in thousandths of the font size, 0 where the encoding has no glyph.
//! They are the `WX` values of Adobe's Core 14 AFM files `Helvetica.afm` and
//! `Helvetica-Bold.afm` (Version 002.000, "Copyright (c) 1985, 1987, 1989,
//! 1990, 1997 Adobe Systems Incorporated. All Rights Reserved. Helvetica is a
//! trademark of Linotype-Hell AG and/or its subsidiaries."), placed by glyph
//! name at the WinAnsiEncoding code of PDF 32000-1:2008, Annex D.2. Adobe's
//! notice permits the metrics to be "used, copied, and distributed for any
//! purpose and without charge, with or without modification, provided that all
//! copyright notices are retained"; the notice is carried here and in NOTICE.
//! No AFM file and no font file is in this repository or in the product.

/// The two faces a report is set in.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Face {
    /// Helvetica.
    Regular,
    /// Helvetica-Bold.
    Bold,
}

impl Face {
    /// The standard font's name, as the PDF names it.
    pub fn base_font(self) -> &'static str {
        match self {
            Face::Regular => "Helvetica",
            Face::Bold => "Helvetica-Bold",
        }
    }

    /// The face's width table.
    fn widths(self) -> &'static [u16; 256] {
        match self {
            Face::Regular => &HELVETICA,
            Face::Bold => &HELVETICA_BOLD,
        }
    }
}

/// The characters outside WinAnsi that are printed as stand-ins, and what is
/// printed. The list is documented in ADR-031 and
/// mirrored by the interface (`src/features/reports/compose/winansi.ts`).
pub const SUBSTITUTES: [(char, &str); 3] = [('→', "->"), ('≥', ">="), ('≤', "<=")];

/// What is printed for a character the faces do not carry.
pub const UNPRINTABLE: u8 = b'?';

/// Windows-1252 between 0x80 and 0x9F, as Unicode; `None` where the encoding
/// has no character (0x81, 0x8D, 0x8F, 0x90, 0x9D).
const HIGH: [Option<char>; 32] = [
    Some('€'),
    None,
    Some('‚'),
    Some('ƒ'),
    Some('„'),
    Some('…'),
    Some('†'),
    Some('‡'),
    Some('ˆ'),
    Some('‰'),
    Some('Š'),
    Some('‹'),
    Some('Œ'),
    None,
    Some('Ž'),
    None,
    None,
    Some('‘'),
    Some('’'),
    Some('“'),
    Some('”'),
    Some('•'),
    Some('–'),
    Some('—'),
    Some('˜'),
    Some('™'),
    Some('š'),
    Some('›'),
    Some('œ'),
    None,
    Some('ž'),
    Some('Ÿ'),
];

/// The WinAnsi code of a character the faces carry as itself.
pub fn code_of(character: char) -> Option<u8> {
    match character {
        ' '..='~' | '\u{A0}'..='\u{FF}' => Some(character as u8),
        _ => HIGH
            .iter()
            .position(|&high| high == Some(character))
            .map(|index| 0x80 + index as u8),
    }
}

/// The character a WinAnsi code prints; `None` for a code with no glyph.
pub fn char_of(code: u8) -> Option<char> {
    match code {
        b' '..=b'~' | 0xA0..=0xFF => Some(code as char),
        0x80..=0x9F => HIGH[usize::from(code - 0x80)],
        _ => None,
    }
}

/// Whether a character is a space of some width: folded onto the space.
fn is_space(character: char) -> bool {
    matches!(
        character,
        '\t' | '\u{1680}' | '\u{2000}'..='\u{200A}' | '\u{202F}' | '\u{205F}' | '\u{3000}'
    )
}

/// Text as WinAnsi bytes. A line break (`\n`, `\r\n` or `\r`) is kept as
/// `\n`, for the layout to break the line at; everything else is a printable
/// code — the character itself, its documented stand-in, or `?`.
pub fn encode(text: &str) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(text.len());
    let mut characters = text.chars().peekable();
    while let Some(character) = characters.next() {
        if let Some(code) = code_of(character) {
            bytes.push(code);
            continue;
        }
        match character {
            '\n' => bytes.push(b'\n'),
            '\r' => {
                if characters.peek() != Some(&'\n') {
                    bytes.push(b'\n');
                }
            }
            c if is_space(c) => bytes.push(b' '),
            '\u{2212}' | '\u{2010}' | '\u{2011}' => bytes.push(b'-'),
            '\u{200B}' | '\u{200C}' | '\u{200D}' | '\u{2060}' | '\u{FEFF}' => {}
            c => match SUBSTITUTES.iter().find(|(from, _)| *from == c) {
                Some((_, to)) => bytes.extend_from_slice(to.as_bytes()),
                None => bytes.push(UNPRINTABLE),
            },
        }
    }
    bytes
}

/// Text as WinAnsi bytes on one line: a line break is a space.
pub fn encode_line(text: &str) -> Vec<u8> {
    encode(text)
        .into_iter()
        .map(|byte| if byte == b'\n' { b' ' } else { byte })
        .collect()
}

/// WinAnsi bytes as text: what a reader shows. Tests read a layout back with
/// it; a code with no glyph reads as U+FFFD.
pub fn decode(bytes: &[u8]) -> String {
    bytes
        .iter()
        .map(|&code| match code {
            b'\n' => '\n',
            _ => char_of(code).unwrap_or('\u{FFFD}'),
        })
        .collect()
}

/// The width of `bytes` set in `face` at `size` points, in points.
pub fn width(bytes: &[u8], face: Face, size: f32) -> f32 {
    let table = face.widths();
    let thousandths: u32 = bytes
        .iter()
        .map(|&code| u32::from(table[usize::from(code)]))
        .sum();
    thousandths as f32 * size / 1000.0
}

/// Helvetica, by WinAnsi code (see the module's header for the source).
#[rustfmt::skip]
pub const HELVETICA: [u16; 256] = [
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
    556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
    1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
    667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
    333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
    556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584, 0,
    556, 0, 222, 556, 333, 1000, 556, 556, 333, 1000, 667, 333, 1000, 0, 611, 0,
    0, 222, 222, 333, 333, 350, 556, 1000, 333, 1000, 500, 333, 944, 0, 500, 667,
    278, 333, 556, 556, 556, 556, 260, 556, 333, 737, 370, 556, 584, 333, 737, 333,
    400, 584, 333, 333, 333, 556, 537, 278, 333, 333, 365, 556, 834, 834, 834, 611,
    667, 667, 667, 667, 667, 667, 1000, 722, 667, 667, 667, 667, 278, 278, 278, 278,
    722, 722, 778, 778, 778, 778, 778, 584, 778, 722, 722, 722, 722, 667, 667, 611,
    556, 556, 556, 556, 556, 556, 889, 500, 556, 556, 556, 556, 278, 278, 278, 278,
    556, 556, 556, 556, 556, 556, 556, 584, 611, 556, 556, 556, 556, 500, 556, 500,
];

/// Helvetica-Bold, by WinAnsi code (see the module's header for the source).
#[rustfmt::skip]
pub const HELVETICA_BOLD: [u16; 256] = [
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
    556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
    975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
    667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
    333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
    611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584, 0,
    556, 0, 278, 556, 500, 1000, 556, 556, 333, 1000, 667, 333, 1000, 0, 611, 0,
    0, 278, 278, 500, 500, 350, 556, 1000, 333, 1000, 556, 333, 944, 0, 500, 667,
    278, 333, 556, 556, 556, 556, 280, 556, 333, 737, 370, 556, 584, 333, 737, 333,
    400, 584, 333, 333, 333, 611, 556, 278, 333, 333, 365, 556, 834, 834, 834, 611,
    722, 722, 722, 722, 722, 722, 1000, 722, 667, 667, 667, 667, 278, 278, 278, 278,
    722, 722, 778, 778, 778, 778, 778, 584, 778, 722, 722, 722, 722, 667, 667, 611,
    556, 556, 556, 556, 556, 556, 889, 556, 556, 556, 556, 556, 278, 278, 278, 278,
    611, 611, 611, 611, 611, 611, 611, 584, 611, 611, 611, 611, 611, 556, 611, 556,
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn portuguese_and_english_as_the_product_writes_them_print_as_themselves() {
        let text = "Relatório semanal · ação, pé, avó, lá, você, órgão, útil, Açaí — “obra” ‘já’ … • 5 € 12 m² 3 × 4 90° nº 1ª – fim";
        let bytes = encode(text);
        assert!(!bytes.contains(&UNPRINTABLE), "{bytes:?}");
        assert_eq!(decode(&bytes), text);
        assert_eq!(bytes.len(), text.chars().count(), "one byte per character");
    }

    #[test]
    fn the_three_documented_substitutes_and_nothing_else_become_stand_ins() {
        assert_eq!(decode(&encode("A → B")), "A -> B");
        assert_eq!(decode(&encode("≥ 3")), ">= 3");
        assert_eq!(decode(&encode("≤ 3")), "<= 3");
        assert_eq!(
            decode(&encode("2 × 3")),
            "2 × 3",
            "× is WinAnsi 0xD7: it is not substituted"
        );
        assert_eq!(code_of('×'), Some(0xD7));
        for (unknown, why) in [
            ('✓', "a check mark"),
            ('😀', "an emoji"),
            ('≈', "almost equal"),
            ('∞', "infinity"),
            ('\u{1}', "a control character"),
        ] {
            assert_eq!(encode(&unknown.to_string()), vec![UNPRINTABLE], "{why}");
        }
    }

    #[test]
    fn what_intl_writes_into_dates_and_numbers_is_folded_onto_what_the_faces_carry() {
        assert_eq!(decode(&encode("10:00\u{202F}AM")), "10:00 AM");
        assert_eq!(decode(&encode("1\u{2009}000")), "1 000");
        assert_eq!(
            decode(&encode("R$\u{A0}1.234,00")),
            "R$\u{A0}1.234,00",
            "the no-break space is WinAnsi 0xA0"
        );
        assert_eq!(decode(&encode("\u{2212}3")), "-3");
        assert_eq!(decode(&encode("a\u{200B}b\u{FEFF}")), "ab");
        assert_eq!(decode(&encode("a\tb")), "a b");
        assert_eq!(encode("a\r\nb\rc\nd"), b"a\nb\nc\nd".to_vec());
        assert_eq!(encode_line("a\r\nb"), b"a b".to_vec());
    }

    #[test]
    fn every_code_with_a_glyph_has_a_width_and_every_code_without_one_has_none() {
        for code in 0u8..=255 {
            let has_glyph = char_of(code).is_some();
            for face in [Face::Regular, Face::Bold] {
                let advance = face.widths()[usize::from(code)];
                assert_eq!(
                    advance > 0,
                    has_glyph,
                    "{face:?} code {code:#04x}: width {advance}"
                );
            }
            if let Some(character) = char_of(code) {
                assert_eq!(code_of(character), Some(code), "{character:?}");
            }
        }
    }

    /// A few values any Helvetica metrics table agrees on — so a table shifted
    /// by one code would fail here.
    #[test]
    fn the_widths_are_helveticas() {
        assert_eq!(HELVETICA[usize::from(b' ')], 278);
        assert_eq!(HELVETICA[usize::from(b'i')], 222);
        assert_eq!(HELVETICA[usize::from(b'W')], 944);
        assert_eq!(HELVETICA[usize::from(b'@')], 1015);
        assert_eq!(HELVETICA_BOLD[usize::from(b'b')], 611);
        assert_eq!(HELVETICA_BOLD[usize::from(b'@')], 975);
        assert_eq!(HELVETICA[0x80], 556, "the euro");
        assert_eq!(HELVETICA[0x97], 1000, "the em dash");
        assert_eq!(HELVETICA[0xE7], 500, "ç");
        assert_eq!(HELVETICA_BOLD[0xE7], 556, "ç, bold");
        assert!((width(b"Ridgebeam", Face::Regular, 10.0) - 51.13).abs() < 0.01);
    }
}
