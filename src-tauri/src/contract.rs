//! The shapes that cross the command boundary, in one file.
//!
//! This is the host's half of the contract; `src/data/commands.ts` is the
//! interface's half, and the two are written to the same text (the F0 plan).
//! Every shape is serialised in camelCase. A field that may be unknown is
//! `null`, never absent, so the interface never has to tell "missing" from
//! "not yet known".
//!
//! Nothing here holds progress, and nothing ever will: progress is derived from
//! the diary (slice F4), and there is no command that writes it.
//!
//! # Changelog of this contract
//!
//! - F0: system, settings, recent works, the work, its calendar, people, stages
//!   and activities, diagnostics.
//! - F1: rooms (`Room`, `WorkSnapshot.rooms`); an activity's rooms, quantity and
//!   unit (`Activity.roomIds`, `quantity`, `unit`, and the same two in
//!   `ActivityPatch`). Positions are contiguous from 1 after every move and
//!   every removal.
//! - F2: dependencies between activities or stages (`Endpoint`, `Dependency`,
//!   `WorkSnapshot.dependencies`); baselines, insert-only (`Baseline`,
//!   `BaselineRow`, `BaselineRowDraft`, `WorkSnapshot.baselines`); the moment
//!   the plan was first approved (`Work.approvedAt`).
//! - F3: decisions (`Decision`, `DecisionPatch`, `WorkSnapshot.decisions`). A
//!   decision's deadline is not here and never will be: it is computed by the
//!   domain from the schedule, every time (ADR-017).

use serde::{Deserialize, Deserializer, Serialize};

/// What About and Diagnostics say about the running build.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemInfo {
    /// Always `Ridgebeam`.
    pub product: &'static str,
    /// The version of the binary that is running — never a hand-typed constant.
    pub version: &'static str,
    /// The operating system, as Rust names it (`windows`).
    pub os: &'static str,
    /// The processor architecture, as Rust names it (`x86_64`).
    pub arch: &'static str,
    /// The folder the application database lives in.
    pub app_data_dir: String,
    /// True when `RIDGEBEAM_DATA_DIR` moved that folder (debug builds only).
    pub database_relocated: bool,
}

/// The person's settings. Every key has a value: one never chosen reads as its
/// default (`system`, `system`, `owner`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    /// `system`, `en` or `pt-BR`.
    pub language: String,
    /// `system`, `light` or `dark`.
    pub theme: String,
    /// `owner`, `architect` or `engineer`.
    pub lens: String,
}

/// A work in the recent list.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentWork {
    /// The work's UUID.
    pub work_id: String,
    /// Its name, as last seen.
    pub name: String,
    /// Its folder, as last seen.
    pub folder: String,
    /// When it was last opened, UTC.
    pub opened_at: String,
    /// Whether that folder still holds a `work.sqlite3` — asked of the disk
    /// when the list is read.
    pub present: bool,
}

/// What a new work starts from.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkDraft {
    /// What the person calls the work.
    pub name: String,
    /// Where it is, as the person writes it. May be empty.
    pub place: String,
    /// `YYYY-MM-DD`, the first day the schedule may use.
    pub start_date: String,
    /// ISO 4217, three letters.
    pub currency: String,
    /// Seven characters, Monday first, `1` working — `1111100`.
    pub working_days: String,
    /// Hours in a working day, more than 0 and at most 24.
    pub hours_per_day: f64,
}

/// The open work, in a line.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkSummary {
    /// The work's UUID.
    pub work_id: String,
    /// What the person calls it.
    pub name: String,
    /// The folder it lives in.
    pub folder: String,
}

/// The work row.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Work {
    /// The work's UUID.
    pub work_id: String,
    /// What the person calls it.
    pub name: String,
    /// Where it is, as written.
    pub place: String,
    /// `YYYY-MM-DD`.
    pub start_date: String,
    /// ISO 4217.
    pub currency: String,
    /// UTC.
    pub created_at: String,
    /// When the plan was first approved — baseline 1 taken — UTC; `null` until
    /// it is. Never changes once set.
    pub approved_at: Option<String>,
}

/// The working calendar durations are counted on.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Calendar {
    /// Seven characters, Monday first, `1` working.
    pub working_days: String,
    /// Hours in a working day.
    pub hours_per_day: f64,
}

/// What `calendar_set` receives for the calendar itself. The same shape as
/// [`Calendar`]; named apart because one is a request and one is a row.
pub type CalendarDraft = Calendar;

/// A day that is not a working day whatever the mask says.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Holiday {
    /// `YYYY-MM-DD`.
    pub date: String,
    /// What it is called.
    pub name: String,
}

/// Somebody who can be responsible for an activity.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Person {
    /// UUID v7.
    pub id: String,
    /// Their name.
    pub name: String,
}

/// A stage of the work.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Stage {
    /// UUID v7.
    pub id: String,
    /// Its order among stages: 1, 2, 3 … with no gaps.
    pub position: i64,
    /// Its name.
    pub name: String,
}

/// A room of the work — the architect's and the owner's map of it. Named by
/// the person; an activity touches zero or more.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Room {
    /// UUID v7.
    pub id: String,
    /// Its order among rooms: 1, 2, 3 … with no gaps.
    pub position: i64,
    /// Its name.
    pub name: String,
}

/// An activity inside a stage.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Activity {
    /// UUID v7.
    pub id: String,
    /// The stage it belongs to.
    pub stage_id: String,
    /// Its order inside the stage: 1, 2, 3 … with no gaps.
    pub position: i64,
    /// Its name.
    pub name: String,
    /// Working days; `null` until somebody knows.
    pub duration_days: Option<i64>,
    /// The person responsible; `null` until somebody is.
    pub responsible_id: Option<String>,
    /// The rooms it touches, in the rooms' order; empty when none.
    pub room_ids: Vec<String>,
    /// How much of it there is, at least 0; `null` when nobody said. Not a
    /// readiness rule: a plan is not less ready for lacking one.
    pub quantity: Option<f64>,
    /// What the quantity is counted in — `m²`, `m`, `un`. Never set without a
    /// quantity.
    pub unit: Option<String>,
}

/// The whole plan, as the interface reads it. At F0 scale a work is small
/// enough to send whole after every edit, which keeps the interface's cache one
/// query and every screen consistent with every other.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkSnapshot {
    /// The work row.
    pub work: Work,
    /// The working calendar.
    pub calendar: Calendar,
    /// Holidays, by date.
    pub holidays: Vec<Holiday>,
    /// People, by name.
    pub people: Vec<Person>,
    /// Stages, by position.
    pub stages: Vec<Stage>,
    /// Rooms, by position.
    pub rooms: Vec<Room>,
    /// Activities, by their stage's position and then their own.
    pub activities: Vec<Activity>,
    /// Dependencies, in the order they were declared.
    pub dependencies: Vec<Dependency>,
    /// Baselines, by number: 1 is the approval.
    pub baselines: Vec<Baseline>,
    /// Decisions, by their stage's position and then their own.
    pub decisions: Vec<Decision>,
}

/// Something the person must decide before a stage can start — "Which tile" —
/// and how long it takes between deciding and having it on site. Its deadline
/// is computed by the domain from the schedule; it is not a field.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Decision {
    /// UUID v7.
    pub id: String,
    /// The stage that needs it.
    pub stage_id: String,
    /// Its order inside the stage: 1, 2, 3 … with no gaps.
    pub position: i64,
    /// What is to be decided.
    pub name: String,
    /// Working days between deciding and having, 0 to 3650.
    pub lead_time_days: i64,
    /// When it was made, UTC; `null` while it is open.
    pub made_at: Option<String>,
    /// What was decided, if the person wrote it; `null` while it is open, and
    /// may be `null` once made.
    pub answer: Option<String>,
}

/// A change to a decision's name or lead time. A field left out is left alone.
/// Making and reopening are commands of their own, not fields.
#[derive(Debug, Clone, Default, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DecisionPatch {
    /// A new name.
    #[serde(default)]
    pub name: Option<String>,
    /// A new lead time, whole working days from 0 to 3650.
    #[serde(default)]
    pub lead_time_days: Option<f64>,
}

/// One end of a dependency: an activity, or a whole stage.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Endpoint {
    /// `activity` or `stage`. Read as text and checked by the host, so that
    /// anything else is `invalid_input` with a sentence.
    pub kind: String,
    /// The activity's or the stage's id.
    pub id: String,
}

/// "`blocked` starts after `blocker` finishes, and `lagDays` working days
/// later." Finish-to-start; a stage endpoint stands for every activity in it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Dependency {
    /// UUID v7.
    pub id: String,
    /// What has to finish first.
    pub blocker: Endpoint,
    /// What waits for it.
    pub blocked: Endpoint,
    /// Working days of waiting between the two, 0 to 3650.
    pub lag_days: i64,
}

/// The plan as it was approved, never rewritten.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Baseline {
    /// UUID v7.
    pub id: String,
    /// 1, 2, 3 … — 1 is the approval.
    pub number: i64,
    /// When it was taken, UTC.
    pub taken_at: String,
    /// Why the plan changed; `null` for baseline 1 and until slice F8 asks.
    pub reason: Option<String>,
    /// The work's finish date at that moment; `null` when nothing was placed.
    pub finish_date: Option<String>,
    /// One row per activity the plan held, in breakdown order.
    pub rows: Vec<BaselineRow>,
}

/// One activity, as a baseline recorded it. The name and stage name are copies:
/// an activity renamed or removed later is still what it was here.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BaselineRow {
    /// The activity's id — which may since have been removed.
    pub activity_id: String,
    /// Its name then.
    pub name: String,
    /// Its stage's name then.
    pub stage_name: String,
    /// Its duration then; `null` when it had none.
    pub duration_days: Option<i64>,
    /// Its start then, `YYYY-MM-DD`; `null` when it was not placed.
    pub start: Option<String>,
    /// Its finish then, `YYYY-MM-DD`; `null` when it was not placed.
    pub finish: Option<String>,
}

/// What `baseline_take` receives for one activity: where the schedule placed
/// it. The schedule is the domain's; everything else about the row — name,
/// stage name, duration — the host reads from the file, so a baseline records
/// what the work held rather than what the interface said it held. Any other
/// field sent is ignored.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BaselineRowDraft {
    /// The activity.
    pub activity_id: String,
    /// Its start, `YYYY-MM-DD`, or `null` when it is not placed.
    #[serde(default)]
    pub start: Option<String>,
    /// Its finish, `YYYY-MM-DD`, or `null` when it is not placed.
    #[serde(default)]
    pub finish: Option<String>,
}

/// A change to the work row. A field left out is left alone.
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkPatch {
    /// A new name.
    #[serde(default)]
    pub name: Option<String>,
    /// A new place; may be empty.
    #[serde(default)]
    pub place: Option<String>,
    /// A new start date, `YYYY-MM-DD`.
    #[serde(default)]
    pub start_date: Option<String>,
    /// A new currency, three letters.
    #[serde(default)]
    pub currency: Option<String>,
}

/// A change to an activity. A field left out is left alone; a field sent as
/// `null` is cleared — "nobody knows the duration yet" is an answer.
///
/// The duration arrives as a JSON number and is checked here to be a whole one,
/// so that `2.5` is a sentence from the host rather than a deserialisation error
/// that would reach the interface without a kind.
#[derive(Debug, Clone, Default, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityPatch {
    /// A new name.
    #[serde(default)]
    pub name: Option<String>,
    /// Absent: unchanged. `null`: unknown. A number: working days.
    #[serde(default, deserialize_with = "present")]
    pub duration_days: Option<Option<f64>>,
    /// Absent: unchanged. `null`: nobody. A string: a person's id.
    #[serde(default, deserialize_with = "present")]
    pub responsible_id: Option<Option<String>>,
    /// Absent: unchanged. `null`: none — and the unit goes with it. A number:
    /// at least 0.
    #[serde(default, deserialize_with = "present")]
    pub quantity: Option<Option<f64>>,
    /// Absent: unchanged. `null` or empty: none. A string: at most 16
    /// characters, and only beside a quantity.
    #[serde(default, deserialize_with = "present")]
    pub unit: Option<Option<String>>,
}

/// What Diagnostics shows.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Diagnostics {
    /// The application database.
    pub app: AppDiagnostics,
    /// The open work's database, or `null` when no work is open.
    pub work: Option<WorkDiagnostics>,
}

/// The application database, as Diagnostics shows it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppDiagnostics {
    /// The file.
    pub database_path: String,
    /// The last migration applied.
    pub schema_version: i64,
}

/// The open work's database, as Diagnostics shows it. The pragmas are read back
/// from the connection, not repeated from the code that set them.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkDiagnostics {
    /// The work folder.
    pub folder: String,
    /// The file.
    pub database_path: String,
    /// The last migration applied.
    pub schema_version: i64,
    /// `wal`.
    pub journal_mode: String,
    /// `off`, `normal`, `full` or `extra`.
    pub synchronous: String,
    /// Whether references are enforced.
    pub foreign_keys: bool,
}

/// A field that was sent, whatever it holds — `null` included — as opposed to
/// one that was left out, which `#[serde(default)]` makes `None`.
fn present<'de, D, T>(deserializer: D) -> std::result::Result<Option<Option<T>>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer).map(Some)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn an_activity_patch_tells_a_field_left_out_from_a_field_sent_as_null() {
        let left_out: ActivityPatch = serde_json::from_value(json!({ "name": "Tiling" })).unwrap();
        assert_eq!(left_out.duration_days, None);
        assert_eq!(left_out.responsible_id, None);

        let cleared: ActivityPatch =
            serde_json::from_value(json!({ "durationDays": null, "responsibleId": null })).unwrap();
        assert_eq!(cleared.duration_days, Some(None));
        assert_eq!(cleared.responsible_id, Some(None));

        let set: ActivityPatch =
            serde_json::from_value(json!({ "durationDays": 3, "responsibleId": "p" })).unwrap();
        assert_eq!(set.duration_days, Some(Some(3.0)));
        assert_eq!(set.responsible_id, Some(Some("p".into())));
    }

    #[test]
    fn a_quantity_and_a_unit_in_a_patch_tell_left_out_from_null() {
        let left_out: ActivityPatch = serde_json::from_value(json!({})).unwrap();
        assert_eq!((left_out.quantity, left_out.unit), (None, None));

        let cleared: ActivityPatch =
            serde_json::from_value(json!({ "quantity": null, "unit": null })).unwrap();
        assert_eq!((cleared.quantity, cleared.unit), (Some(None), Some(None)));

        let set: ActivityPatch =
            serde_json::from_value(json!({ "quantity": 12, "unit": "m²" })).unwrap();
        assert_eq!(set.quantity, Some(Some(12.0)));
        assert_eq!(set.unit, Some(Some("m²".into())));
    }

    #[test]
    fn a_draft_is_read_in_camel_case() {
        let draft: WorkDraft = serde_json::from_value(json!({
            "name": "Bathroom", "place": "", "startDate": "2026-10-05", "currency": "BRL",
            "workingDays": "1111100", "hoursPerDay": 8
        }))
        .unwrap();
        assert_eq!(draft.start_date, "2026-10-05");
        assert_eq!(draft.hours_per_day, 8.0);
    }

    #[test]
    fn an_activity_is_written_in_camel_case_with_its_unknowns_as_null() {
        let activity = Activity {
            id: "a".into(),
            stage_id: "s".into(),
            position: 1,
            name: "Tiling".into(),
            duration_days: None,
            responsible_id: None,
            room_ids: vec![],
            quantity: Some(12.0),
            unit: Some("m²".into()),
        };
        assert_eq!(
            serde_json::to_value(activity).unwrap(),
            json!({
                "id": "a", "stageId": "s", "position": 1, "name": "Tiling",
                "durationDays": null, "responsibleId": null,
                "roomIds": [], "quantity": 12.0, "unit": "m²"
            })
        );
    }
}
