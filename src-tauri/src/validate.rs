//! What the host refuses before it writes, and the sentence it refuses with.
//!
//! The domain checks the same rules first (`src/domain/`), and the schema
//! checks them again last (`work_migrations/001_init.sql`). The host checks
//! them in between because it does not trust the webview: a value that reaches
//! a `CHECK` is a `database` error with a generic sentence, and a value refused
//! here is an `invalid_input` error that names the field and what it takes.
//!
//! Every function returns the value as it will be stored — trimmed, and for a
//! currency upper-cased — so that what was checked is what is written.

use chrono::NaiveDate;

use crate::db::order::Direction;
use crate::error::{Error, Result};

/// The longest unit a quantity is counted in — `m²`, `m`, `un`, `sacks`.
pub const MAX_UNIT_CHARS: usize = 16;

/// A quantity: a number, at least 0.
///
/// # Errors
///
/// [`Error::InvalidInput`] for a negative number or one that is not a number.
pub fn quantity(value: f64) -> Result<f64> {
    if value.is_finite() && value >= 0.0 {
        Ok(value)
    } else {
        Err(invalid("A quantity is a number, 0 or more."))
    }
}

/// A unit: trimmed, at most [`MAX_UNIT_CHARS`] characters. Nothing, or only
/// spaces, is no unit.
///
/// # Errors
///
/// [`Error::InvalidInput`] when it is too long.
pub fn unit(value: Option<&str>) -> Result<Option<String>> {
    let Some(value) = value.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    if value.chars().count() > MAX_UNIT_CHARS {
        return Err(invalid(format!(
            "A unit is at most {MAX_UNIT_CHARS} characters, such as m² or un."
        )));
    }
    Ok(Some(value.to_string()))
}

/// Which way a row moves: `up` or `down`, exactly as written.
///
/// Taken as text and read here, rather than left to the deserialiser, so that
/// a direction that is neither is a sentence with a kind like every other
/// refusal, not an error the interface cannot translate.
///
/// # Errors
///
/// [`Error::InvalidInput`] for anything else.
pub fn direction(value: &str) -> Result<Direction> {
    match value {
        "up" => Ok(Direction::Up),
        "down" => Ok(Direction::Down),
        _ => Err(invalid("A move is up or down.")),
    }
}

/// The longest name any row of a work keeps — a work, a stage, an activity, a
/// person, a holiday. One number for one idea; the schema spells it out in SQL.
pub const MAX_NAME_CHARS: usize = 120;

/// The longest place a work keeps.
pub const MAX_PLACE_CHARS: usize = 200;

/// The longest duration an activity may have, in working days: ten years of
/// five-day weeks, far past any activity a work of this kind has.
pub const MAX_DURATION_DAYS: i64 = 3650;

/// The longest working day, in hours.
pub const MAX_HOURS_PER_DAY: f64 = 24.0;

fn invalid(sentence: impl Into<String>) -> Error {
    Error::InvalidInput(sentence.into())
}

/// `A` or `An`, for the noun a sentence starts with.
fn article(noun: &str) -> &'static str {
    match noun.chars().next() {
        Some('a' | 'e' | 'i' | 'o' | 'u') => "An",
        _ => "A",
    }
}

/// A name: trimmed, not empty, at most [`MAX_NAME_CHARS`] characters. `what`
/// is the noun the sentence is about — `work`, `stage`, `activity`, `person`,
/// `holiday`.
///
/// # Errors
///
/// [`Error::InvalidInput`] naming what needs a name, or how long it may be.
pub fn name(what: &str, value: &str) -> Result<String> {
    let value = value.trim();
    if value.is_empty() {
        return Err(invalid(format!("{} {what} needs a name.", article(what))));
    }
    if value.chars().count() > MAX_NAME_CHARS {
        return Err(invalid(format!(
            "{} {what}'s name is at most {MAX_NAME_CHARS} characters.",
            article(what)
        )));
    }
    Ok(value.to_string())
}

/// A place: trimmed, may be empty, at most [`MAX_PLACE_CHARS`] characters.
///
/// # Errors
///
/// [`Error::InvalidInput`] when it is too long.
pub fn place(value: &str) -> Result<String> {
    let value = value.trim();
    if value.chars().count() > MAX_PLACE_CHARS {
        return Err(invalid(format!(
            "A work's place is at most {MAX_PLACE_CHARS} characters."
        )));
    }
    Ok(value.to_string())
}

/// A calendar date written `YYYY-MM-DD`, and a day that exists.
///
/// # Errors
///
/// [`Error::InvalidInput`] naming the field.
pub fn date(what: &str, value: &str) -> Result<String> {
    let value = value.trim();
    let parsed = NaiveDate::parse_from_str(value, "%Y-%m-%d").ok();
    // Formatting it back refuses `2026-1-5`, which chrono reads leniently.
    match parsed {
        Some(day) if day.format("%Y-%m-%d").to_string() == value => Ok(value.to_string()),
        _ => Err(invalid(format!(
            "{what} is a date written YYYY-MM-DD, on a day that exists."
        ))),
    }
}

/// A currency: three letters, ISO 4217, stored upper-case.
///
/// # Errors
///
/// [`Error::InvalidInput`] when it is not three letters.
pub fn currency(value: &str) -> Result<String> {
    let value = value.trim().to_ascii_uppercase();
    if value.len() == 3 && value.bytes().all(|b| b.is_ascii_uppercase()) {
        Ok(value)
    } else {
        Err(invalid(
            "A currency is three letters, as ISO 4217 writes it — BRL, EUR, USD.",
        ))
    }
}

/// A working week: seven characters, Monday first, `1` working and `0` not,
/// with at least one working day.
///
/// # Errors
///
/// [`Error::InvalidInput`] when it is not seven ones and zeros, or has no
/// working day — nothing could ever be scheduled on such a calendar.
pub fn working_days(value: &str) -> Result<String> {
    if value.len() != 7 || !value.bytes().all(|b| b == b'0' || b == b'1') {
        return Err(invalid(
            "A working week is seven days, Monday first, each working or not.",
        ));
    }
    if !value.contains('1') {
        return Err(invalid("A working week needs at least one working day."));
    }
    Ok(value.to_string())
}

/// Hours in a working day: more than 0, at most 24.
///
/// # Errors
///
/// [`Error::InvalidInput`] outside that range, or for a number that is not one.
pub fn hours_per_day(value: f64) -> Result<f64> {
    if value.is_finite() && value > 0.0 && value <= MAX_HOURS_PER_DAY {
        Ok(value)
    } else {
        Err(invalid(
            "A working day is more than 0 and at most 24 hours.",
        ))
    }
}

/// A duration: a whole number of working days, from 1 to [`MAX_DURATION_DAYS`].
///
/// # Errors
///
/// [`Error::InvalidInput`] for 0, a fraction, or a number past the bound.
pub fn duration_days(value: f64) -> Result<i64> {
    if value.is_finite()
        && value.fract() == 0.0
        && (1.0..=MAX_DURATION_DAYS as f64).contains(&value)
    {
        Ok(value as i64)
    } else {
        Err(invalid(format!(
            "A duration is a whole number of working days, from 1 to {MAX_DURATION_DAYS}."
        )))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_name_is_trimmed_and_an_empty_or_long_one_is_refused_with_a_sentence() {
        assert_eq!(name("stage", "  Bathroom ").unwrap(), "Bathroom");
        assert_eq!(
            name("stage", "   ").unwrap_err().to_string(),
            "A stage needs a name."
        );
        assert_eq!(
            name("activity", &"x".repeat(121)).unwrap_err().to_string(),
            "An activity's name is at most 120 characters."
        );
        name("person", &"é".repeat(120)).expect("120 characters, whatever their bytes");
    }

    #[test]
    fn a_date_must_be_written_in_full_and_exist() {
        assert_eq!(date("The start", "2026-10-05").unwrap(), "2026-10-05");
        date("The start", "2028-02-29").expect("a leap day that exists");
        for refused in [
            "2026-02-30",
            "2026-1-5",
            "05/10/2026",
            "",
            "2026-10-05T00:00",
        ] {
            assert_eq!(
                date("The start", refused).unwrap_err().kind(),
                "invalid_input",
                "`{refused}`"
            );
        }
    }

    #[test]
    fn a_currency_is_three_letters_and_is_stored_upper_case() {
        assert_eq!(currency(" brl ").unwrap(), "BRL");
        for refused in ["", "RE", "EURO", "R$1", "12A", "ÉUR"] {
            assert!(currency(refused).is_err(), "`{refused}`");
        }
    }

    #[test]
    fn a_working_week_with_no_working_day_is_refused() {
        assert_eq!(working_days("1111100").unwrap(), "1111100");
        assert_eq!(
            working_days("0000000").unwrap_err().to_string(),
            "A working week needs at least one working day."
        );
        for refused in ["111110", "11111000", "1111102", "", "1111l00"] {
            assert!(working_days(refused).is_err(), "`{refused}`");
        }
    }

    #[test]
    fn a_working_day_of_zero_hours_or_more_than_a_day_is_refused() {
        assert_eq!(hours_per_day(8.0).unwrap(), 8.0);
        hours_per_day(24.0).expect("a day is at most 24 hours");
        for refused in [0.0, -1.0, 24.5, f64::NAN, f64::INFINITY] {
            assert!(hours_per_day(refused).is_err(), "`{refused}`");
        }
    }

    #[test]
    fn a_duration_of_zero_or_a_fraction_is_refused() {
        assert_eq!(duration_days(3.0).unwrap(), 3);
        assert_eq!(duration_days(3650.0).unwrap(), 3650);
        for refused in [0.0, -2.0, 2.5, 3651.0, f64::NAN] {
            assert_eq!(
                duration_days(refused).unwrap_err().kind(),
                "invalid_input",
                "`{refused}`"
            );
        }
    }

    #[test]
    fn a_negative_quantity_is_refused_and_zero_is_a_quantity() {
        assert_eq!(quantity(12.5).unwrap(), 12.5);
        assert_eq!(quantity(0.0).unwrap(), 0.0);
        for refused in [-0.5, -12.0, f64::NAN, f64::INFINITY] {
            assert_eq!(
                quantity(refused).unwrap_err().kind(),
                "invalid_input",
                "`{refused}`"
            );
        }
    }

    #[test]
    fn a_unit_is_trimmed_an_empty_one_is_none_and_a_long_one_is_refused() {
        assert_eq!(unit(Some(" m² ")).unwrap().as_deref(), Some("m²"));
        assert_eq!(unit(Some("   ")).unwrap(), None);
        assert_eq!(unit(Some("")).unwrap(), None);
        assert_eq!(unit(None).unwrap(), None);
        unit(Some(&"²".repeat(16))).expect("16 characters, whatever their bytes");
        assert_eq!(
            unit(Some(&"u".repeat(17))).unwrap_err().kind(),
            "invalid_input"
        );
    }

    #[test]
    fn a_direction_is_up_or_down_exactly() {
        assert_eq!(direction("up").unwrap(), Direction::Up);
        assert_eq!(direction("down").unwrap(), Direction::Down);
        for refused in ["Up", "left", "", " down"] {
            assert_eq!(
                direction(refused).unwrap_err().to_string(),
                "A move is up or down."
            );
        }
    }
}
