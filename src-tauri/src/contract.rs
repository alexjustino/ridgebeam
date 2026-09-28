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
//! - F4: the diary (`EntryDraft`, `DoneDraft`, `DiaryEntry`, `DoneLine`,
//!   `Photo`, `DiaryRange`, `ChainReport`). Not in `WorkSnapshot`: at 3 000
//!   entries and 10 000 photos it is read on its own. There is no shape that
//!   edits an entry; a correction is a new `EntryDraft` of kind `correction`.
//! - F5: checks and gates (`Check`, `CheckAnswer`, `WorkSnapshot.checks`,
//!   `WorkSnapshot.checkAnswers`); a stage's lifecycle (`Stage.startedAt`,
//!   `Stage.closedAt`). Answers are append-only facts; the latest counts.
//! - F6: money (`CostLine`, `Commitment`, `Payment` and their drafts and
//!   patches; `WorkSnapshot.costLines`, `.commitments`, `.payments`); a
//!   person's trade (`Person.trade`, `PersonPatch`, which replaces the name
//!   alone of `person_rename`). Amounts are whole minor units (`amountCents`).
//!   The ledger is in the snapshot: payments are few enough in 1.0; a work with
//!   thousands would read them on their own, as the diary does.
//! - F7: people as contacts (`Person.phone`, `.email`, `.note`,
//!   `.availability`, `.stageIds`, and the same in `PersonPatch`); documents
//!   (`Document`, `DocumentLink`, `DocumentTarget`, `DocumentPatch`,
//!   `DocumentsAdded`, `RefusedFile`, `DocumentsReport`, `FolderHealth`;
//!   `WorkSnapshot.documents`).
//! - F8: replanning (`Replanning`, `WorkSnapshot.replanning` — the one open,
//!   or `null`); baselines learn stages and money (`BaselineStage`,
//!   `Baseline.stages`, `Baseline.plannedCents`, `BaselineRow.plannedCents`).
//!   Money a baseline did not record — one taken before F8 — is `null`, never
//!   0. `BaselineRowDraft` is unchanged: the host reads the money from the file.

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

/// Somebody who can be responsible for an activity, and be paid.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Person {
    /// UUID v7.
    pub id: String,
    /// Their name.
    pub name: String,
    /// Their trade — `tiler`, `plumber` — as the person writes it; `null` when
    /// not said. Money per trade groups by it.
    pub trade: Option<String>,
    /// As typed; never dialled or checked.
    pub phone: Option<String>,
    /// As typed; nothing is ever sent to it — the product has no network.
    pub email: Option<String>,
    /// A word about them.
    pub note: Option<String>,
    /// When they can come, in their own words.
    pub availability: Option<String>,
    /// The stages they are expected on, in the stages' order.
    pub stage_ids: Vec<String>,
}

/// A change to a person. A field left out is left alone; `trade: null` (or
/// empty) clears the trade.
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersonPatch {
    /// A new name.
    #[serde(default)]
    pub name: Option<String>,
    /// Absent: unchanged. `null` or empty: no trade. A string: the trade.
    #[serde(default, deserialize_with = "present")]
    pub trade: Option<Option<String>>,
    /// Absent: unchanged. `null` or empty: none.
    #[serde(default, deserialize_with = "present")]
    pub phone: Option<Option<String>>,
    /// Absent: unchanged. `null` or empty: none.
    #[serde(default, deserialize_with = "present")]
    pub email: Option<Option<String>>,
    /// Absent: unchanged. `null` or empty: none.
    #[serde(default, deserialize_with = "present")]
    pub note: Option<Option<String>>,
    /// Absent: unchanged. `null` or empty: none.
    #[serde(default, deserialize_with = "present")]
    pub availability: Option<Option<String>>,
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
    /// When it was started, UTC; `null` while it is planned. Never undone.
    pub started_at: Option<String>,
    /// When it was closed, UTC; `null` while it is open. Cleared by a reopen.
    pub closed_at: Option<String>,
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
    /// Checks, by their stage's position, then gate (start before close), then
    /// their own position.
    pub checks: Vec<Check>,
    /// Every answer ever given, in the checks' order and then by `seq`. The
    /// latest answer of a check is the one that counts.
    pub check_answers: Vec<CheckAnswer>,
    /// Planned money: cost lines, by stage position, then as written.
    pub cost_lines: Vec<CostLine>,
    /// Committed money: commitments, by stage position, then as agreed.
    pub commitments: Vec<Commitment>,
    /// Paid money: the ledger, by `seq` — reversals included, as they were
    /// written.
    pub payments: Vec<Payment>,
    /// The files the work holds, by the day they were added, then as added.
    pub documents: Vec<Document>,
    /// The replanning that is open, or `null`. While the plan is approved and
    /// this is `null`, the plan is locked (`plan_approved`).
    pub replanning: Option<Replanning>,
}

/// An approved plan being changed, and why. Opened with a reason; closed only
/// by taking the next baseline, which copies the reason. Only the open one
/// crosses the boundary: a closed one lives on as its baseline's `reason`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Replanning {
    /// UUID v7.
    pub id: String,
    /// Why the plan changes, 1 to 2000 characters.
    pub reason: String,
    /// When it was opened, UTC.
    pub opened_at: String,
    /// The Windows account that opened it.
    pub author_name: String,
}

/// What a document is attached to: the work, a stage, an activity, a
/// decision, a commitment (by id), or a diary entry or a payment (by `seq`,
/// written as text — `"3"`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentTarget {
    /// `work`, `stage`, `activity`, `decision`, `entry`, `commitment` or
    /// `payment`.
    pub target_kind: String,
    /// The target's id; for an entry or a payment, its `seq` as text; for the
    /// work, its `workId`.
    pub target_id: String,
}

/// One attachment of a document.
pub type DocumentLink = DocumentTarget;

/// A file the work owns: copied into its folder, typed by its bytes, named by
/// its hash.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Document {
    /// UUID.
    pub id: String,
    /// SHA-256 of the bytes.
    pub file_hash: String,
    /// The name it had when it was added.
    pub file_name: String,
    /// `image/jpeg`, `image/png`, `image/gif`, `image/webp`, `image/bmp` or
    /// `application/pdf` — or `application/octet-stream` for a file recorded
    /// before F7 whose bytes the folder no longer holds.
    pub media_type: String,
    /// Its size; 0 only in that same case.
    pub bytes: i64,
    /// Its width in pixels, for an image; `null` for a PDF.
    pub width: Option<i64>,
    /// Its height in pixels, for an image; `null` for a PDF.
    pub height: Option<i64>,
    /// `photo`, `quote`, `drawing`, `permit`, `receipt`, `contract` or `other`.
    pub kind: String,
    /// Its title — the file name until somebody changes it.
    pub title: String,
    /// The day it was added.
    pub added_on: String,
    /// The account that added it.
    pub author_name: String,
    /// When, UTC.
    pub created_at: String,
    /// What it is attached to; empty when attached to nothing.
    pub links: Vec<DocumentLink>,
}

/// A change to a document's title or kind. A field left out is left alone.
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentPatch {
    /// A new title.
    #[serde(default)]
    pub title: Option<String>,
    /// A new kind.
    #[serde(default)]
    pub kind: Option<String>,
}

/// A file the host would not keep, and why — the sentence names the file.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RefusedFile {
    /// The file's name, as chosen.
    pub file_name: String,
    /// Why, as a sentence.
    pub reason: String,
}

/// What `document_add` did: the plan with every file it kept, and every file
/// it did not.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentsAdded {
    /// The whole plan, as it now is.
    pub snapshot: WorkSnapshot,
    /// Each file refused, in the order given.
    pub refused: Vec<RefusedFile>,
}

/// A document whose bytes are not the ones recorded.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MismatchedDocument {
    /// The document.
    pub id: String,
    /// Its file name.
    pub file_name: String,
    /// The hash the row recorded.
    pub expected: String,
    /// The hash of the bytes on disk.
    pub found: String,
}

/// A document whose file is not in the folder.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MissingDocument {
    /// The document.
    pub id: String,
    /// Its file name.
    pub file_name: String,
    /// The hash it should have.
    pub file_hash: String,
}

/// What re-reading every document's bytes found.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentsReport {
    /// How many documents were checked.
    pub checked: i64,
    /// Documents whose bytes changed.
    pub mismatched: Vec<MismatchedDocument>,
    /// Documents whose file is gone.
    pub missing: Vec<MissingDocument>,
    /// Files in `documents/` or `thumbnails/` that no row names, as
    /// `documents/<name>` — listed, never removed by the product.
    pub orphans: Vec<String>,
}

/// The work folder, measured.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderHealth {
    /// Every byte in the folder — database, documents, thumbnails.
    pub folder_bytes: i64,
    /// Files in `documents/`.
    pub document_files: i64,
    /// Files in `thumbnails/`.
    pub thumbnail_files: i64,
}

/// Planned money: a line on a stage, or on one of its activities.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CostLine {
    /// UUID v7.
    pub id: String,
    /// The stage it belongs to — the activity's stage, when it names one.
    pub stage_id: String,
    /// The activity, or `null` for a line on the stage itself.
    pub activity_id: Option<String>,
    /// What it is for.
    pub label: String,
    /// How much, in the currency's minor unit; 0 or more.
    pub amount_cents: i64,
}

/// A change to a cost line. A field left out is left alone.
#[derive(Debug, Clone, Default, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CostLinePatch {
    /// A new label.
    #[serde(default)]
    pub label: Option<String>,
    /// A new amount, whole minor units, 0 or more.
    #[serde(default)]
    pub amount_cents: Option<f64>,
}

/// Committed money: a quote or contract accepted.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Commitment {
    /// UUID v7.
    pub id: String,
    /// The stage it is for.
    pub stage_id: String,
    /// Who it was agreed with; `null` when nobody was named.
    pub person_id: Option<String>,
    /// What it is.
    pub label: String,
    /// How much, in the currency's minor unit; 0 or more.
    pub amount_cents: i64,
    /// The day it was agreed.
    pub agreed_on: String,
    /// The quote or contract, as an image in the work, by hash; `null` when
    /// none.
    pub document_hash: Option<String>,
    /// Whether a payment names it — from then on it cannot be changed or
    /// removed.
    pub locked: bool,
}

/// A change to a commitment, while nothing is paid against it. A field left
/// out is left alone.
#[derive(Debug, Clone, Default, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitmentPatch {
    /// Absent: unchanged. `null`: nobody. A string: a person's id.
    #[serde(default, deserialize_with = "present")]
    pub person_id: Option<Option<String>>,
    /// A new label.
    #[serde(default)]
    pub label: Option<String>,
    /// A new amount, whole minor units, 0 or more.
    #[serde(default)]
    pub amount_cents: Option<f64>,
    /// A new day it was agreed.
    #[serde(default)]
    pub agreed_on: Option<String>,
    /// A new document, copied in from this path.
    #[serde(default)]
    pub document_path: Option<String>,
    /// Absent: unchanged. `null`: no document. A hash: a document the work
    /// holds.
    #[serde(default, deserialize_with = "present")]
    pub document_hash: Option<Option<String>>,
}

/// Paid money: one line of the ledger — never edited. A reversal is a
/// payment with a negative amount that names the one it reverses.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Payment {
    /// UUID v7.
    pub id: String,
    /// 1, 2, 3 … for the whole work, in the order written.
    pub seq: i64,
    /// The day it was paid.
    pub day: String,
    /// Who was paid; `null` when not said.
    pub person_id: Option<String>,
    /// The stage it was for.
    pub stage_id: String,
    /// The commitment it pays against; `null` when none.
    pub commitment_id: Option<String>,
    /// How much, in the currency's minor unit: positive for a payment,
    /// negative for a reversal.
    pub amount_cents: i64,
    /// What it was for — for a reversal, why; `null` when not said.
    pub what_for: Option<String>,
    /// The payment this one reverses; `null` for a payment.
    pub reverses_seq: Option<i64>,
    /// The receipt, as an image in the work, by hash; `null` when none.
    pub receipt_hash: Option<String>,
    /// The Windows account that recorded it.
    pub author_name: String,
    /// When it was recorded, UTC.
    pub created_at: String,
}

/// A payment as the interface sends it.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaymentDraft {
    /// `YYYY-MM-DD`, not after today.
    pub day: String,
    /// The stage it is for — required.
    pub stage_id: String,
    /// Who was paid.
    #[serde(default)]
    pub person_id: Option<String>,
    /// The commitment it pays against — of the same stage.
    #[serde(default)]
    pub commitment_id: Option<String>,
    /// How much, whole minor units, more than 0.
    pub amount_cents: f64,
    /// What it was for, at most 200 characters.
    #[serde(default)]
    pub what_for: Option<String>,
    /// A receipt image to copy in, by full path.
    #[serde(default)]
    pub receipt_path: Option<String>,
    /// A receipt image the work already holds, by hash.
    #[serde(default)]
    pub receipt_hash: Option<String>,
}

/// A question a stage must answer at one of its gates.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Check {
    /// UUID v7.
    pub id: String,
    /// The stage it belongs to.
    pub stage_id: String,
    /// `start` or `close`.
    pub gate: String,
    /// Its order in its gate: 1, 2, 3 … with no gaps.
    pub position: i64,
    /// The question, at most 200 characters.
    pub name: String,
}

/// One answer to a check — a fact, never rewritten.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckAnswer {
    /// UUID v7.
    pub id: String,
    /// The check.
    pub check_id: String,
    /// 1, 2, 3 … for this check; the highest is the latest.
    pub seq: i64,
    /// `yes`, `no` or `na`.
    pub answer: String,
    /// Why — always present for `na`, optional otherwise.
    pub reason: Option<String>,
    /// A photo that shows it (an inspection), by hash; `null` when none.
    pub photo_hash: Option<String>,
    /// The Windows account that answered, by its display name.
    pub author_name: String,
    /// When, UTC.
    pub answered_at: String,
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
    /// Why the plan changed — the reason of the replanning it closed; `null`
    /// for baseline 1 (the approval), and for a later one taken before F8
    /// asked.
    pub reason: Option<String>,
    /// The work's finish date at that moment; `null` when nothing was placed.
    pub finish_date: Option<String>,
    /// The work's planned money at that moment — every cost line, in the
    /// currency's minor unit; `null` when it was not recorded (a baseline
    /// taken before F8), never 0 for that.
    pub planned_cents: Option<i64>,
    /// One row per stage the plan held, in their order.
    pub stages: Vec<BaselineStage>,
    /// One row per activity the plan held, in breakdown order.
    pub rows: Vec<BaselineRow>,
}

/// One stage, as a baseline recorded it. Stages compare by id: a stage renamed
/// between two baselines is the same stage.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BaselineStage {
    /// The stage's id — which may since have been removed. For a baseline
    /// taken before F8 whose stage has no activity left, an id derived from
    /// the stage's name.
    pub stage_id: String,
    /// Its order then: 1, 2, 3 … with no gaps.
    pub position: i64,
    /// Its name then.
    pub name: String,
    /// Its planned money then — every cost line of the stage, its activities'
    /// included; `null` when not recorded.
    pub planned_cents: Option<i64>,
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
    /// Its planned money then — the cost lines that name it; `null` when not
    /// recorded.
    pub planned_cents: Option<i64>,
}

/// What `baseline_take` receives for one activity: where the schedule placed
/// it. The schedule is the domain's; everything else about the row — name,
/// stage name, duration, money — and the baseline's stages and reason, the
/// host reads from the file, so a baseline records
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

/// What was done to one activity on the day, as the interface sends it.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DoneDraft {
    /// The activity.
    pub activity_id: String,
    /// `worked` or `finished`.
    pub state: String,
    /// How much of it was done that day; at least 0.
    #[serde(default)]
    pub quantity: Option<f64>,
    /// A word about it, at most 500 characters.
    #[serde(default)]
    pub note: Option<String>,
}

/// A new diary entry — or a correction, which restates the whole day.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EntryDraft {
    /// `YYYY-MM-DD`, never after today.
    pub day: String,
    /// `entry` or `correction`.
    pub kind: String,
    /// The entry a correction corrects; `null` for an entry.
    #[serde(default)]
    pub corrects_seq: Option<i64>,
    /// What happened, at most 4000 characters; a correction says what was wrong.
    #[serde(default)]
    pub note: String,
    /// `sun`, `cloud`, `rain`, `storm`, `wind`, `other`, or `null`.
    #[serde(default)]
    pub weather: Option<String>,
    /// No work was possible that day.
    #[serde(default)]
    pub lost_day: bool,
    /// Hours worked on site, 0 to 24.
    #[serde(default)]
    pub hours: Option<f64>,
    /// What arrived, at most 2000 characters.
    #[serde(default)]
    pub deliveries: Option<String>,
    /// What went wrong, at most 2000 characters.
    #[serde(default)]
    pub incidents: Option<String>,
    /// Who came to see, at most 2000 characters.
    #[serde(default)]
    pub visitors: Option<String>,
    /// What was done, one line per activity.
    #[serde(default)]
    pub done: Vec<DoneDraft>,
    /// Who was on site, by person id.
    #[serde(default)]
    pub present: Vec<String>,
    /// Files the person chose, as full paths; the host copies each in under its
    /// caps, or refuses the whole entry.
    #[serde(default)]
    pub photo_paths: Vec<String>,
    /// Photos already in the work, re-attached by their hash; nothing is copied
    /// twice.
    #[serde(default)]
    pub photo_hashes: Vec<String>,
}

/// One done line, as the diary holds it.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DoneLine {
    /// The activity — which may since have been removed from the plan.
    pub activity_id: String,
    /// `worked` or `finished`.
    pub state: String,
    /// How much was done; `null` when nobody said.
    pub quantity: Option<f64>,
    /// A word about it; `null` when none.
    pub note: Option<String>,
}

/// A photo of an entry: a copy the work owns, named by the SHA-256 of its bytes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Photo {
    /// SHA-256 of the bytes, 64 lowercase hex digits.
    pub file_hash: String,
    /// The name the file had when it was chosen.
    pub file_name: String,
    /// Its size.
    pub bytes: i64,
    /// Its width in pixels, from its header.
    pub width: i64,
    /// Its height in pixels, from its header.
    pub height: i64,
    /// Whether a thumbnail could be drawn; `false` means the photo was kept
    /// and the screen says it cannot show it small.
    pub thumbnail: bool,
}

/// One diary entry, never edited.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiaryEntry {
    /// 1, 2, 3 … in the order written — the chain's order.
    pub seq: i64,
    /// The day it is about.
    pub day: String,
    /// `entry` or `correction`.
    pub kind: String,
    /// The entry it corrects; `null` for an entry.
    pub corrects_seq: Option<i64>,
    /// What happened; `null` when nothing was written.
    pub note: Option<String>,
    /// The weather; `null` when not said.
    pub weather: Option<String>,
    /// No work was possible.
    pub lost_day: bool,
    /// Hours on site; `null` when not said.
    pub hours: Option<f64>,
    /// What arrived.
    pub deliveries: Option<String>,
    /// What went wrong.
    pub incidents: Option<String>,
    /// Who visited.
    pub visitors: Option<String>,
    /// The Windows account that wrote it, by its display name.
    pub author_name: String,
    /// When it was written, UTC.
    pub created_at: String,
    /// The hash of the entry before it; empty for the first.
    pub prev_hash: String,
    /// The SHA-256 of its canonical form.
    pub hash: String,
    /// What was done, by activity id.
    pub done: Vec<DoneLine>,
    /// Who was on site, by person id, sorted.
    pub present: Vec<String>,
    /// Its photos, in the order attached.
    pub photos: Vec<Photo>,
}

/// Which days `diary_list` reads; both ends inclusive, either may be left out.
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiaryRange {
    /// The first day, `YYYY-MM-DD`.
    #[serde(default)]
    pub from_day: Option<String>,
    /// The last day, `YYYY-MM-DD`.
    #[serde(default)]
    pub to_day: Option<String>,
}

/// What `diary_verify` found, after recomputing every hash and every link.
/// `brokenAt`, `problem` and `reason` are present only when the chain is not
/// intact.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChainReport {
    /// How many entries the diary holds.
    pub entries: i64,
    /// Every hash matches its entry and every entry points at the one before.
    pub intact: bool,
    /// The first entry at which the chain breaks.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub broken_at: Option<i64>,
    /// What broke there, as a word the interface translates: `contents` (the
    /// entry does not match its hash), `link` (it does not point at the entry
    /// before it), `missing` (the entry is not there).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub problem: Option<&'static str>,
    /// The same, as an English sentence, for the log and for Diagnostics.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
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
