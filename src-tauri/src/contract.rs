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
//! - F9: templates. An activity's range (`Activity.durationMinDays`,
//!   `.durationMaxDays`) and a decision's (`Decision.leadMinDays`,
//!   `.leadMaxDays`), both or neither; a cost line not priced yet
//!   (`CostLine.amountCents: null`, and `null` accepted by `cost_line_add` and
//!   `CostLinePatch.amountCents`); where the plan came from
//!   (`Work.templateId`, `.templateVersion`, `.templateTitle`). A plan applied
//!   whole (`PlanDraft` and its parts, keyed locally; `Provenance`;
//!   `PlanStart`, what `work_create` may carry).
//! - F10: reports. `WrittenFile`, what a report or export command wrote
//!   (`pages` present for a PDF only); the document itself is
//!   `report::model::ReportDocument`. The shapes of `WorkSnapshot` and
//!   `DiaryEntry` are also the JSON export's, and a test reads an export back
//!   into them (they derive `Deserialize` under `cfg(test)` only: no command
//!   accepts one).
//! - F11: backup and restore (`BackupWritten`, `BackupSummary`, `Restored`,
//!   `BackupLast`); the migrations a database has been through
//!   (`MigrationApplied`, `AppDiagnostics.migrations`,
//!   `WorkDiagnostics.migrations`). `diagnostics_summary` answers plain text.
//! - D1: an activity's range is editable on any activity
//!   (`ActivityPatch.durationMinDays`, `.durationMaxDays`: sent together or
//!   not at all, `null` for both clears it). `Activity` is unchanged: the
//!   fields F9 added now say the optimistic and the pessimistic duration,
//!   whoever gave them.
//! - D2: a commitment's payment plan (`Milestone`, `Commitment.milestones`,
//!   by position, empty when none; `MilestonePatch`; `UsualLabels`, the words
//!   `milestones_usual` writes). A share is whole basis points (`shareBp`,
//!   3000 is 30 %). Nothing earned, due or ahead crosses the boundary: it is
//!   the domain's, computed every time.
//! - D3: the handover book. A check may need its photo (`Check.needsPhoto`,
//!   `CheckDraft.needsPhoto` — optional, `false` when left out); two more
//!   document kinds (`warranty`, `manual`); care notes (`CareNote`,
//!   `WorkSnapshot.careNotes`, by target and position). The report's `image`
//!   block is `report::model::Block::Image`.
//! - D4: the owner's snapshot. No new shape: `report_html_write` takes the
//!   same `ReportDocument`, of the new kind `snapshot`, and answers
//!   `WrittenFile` without `pages` (`{ path, bytes }`).
//! - E1: change orders (`ChangeOrder`, `ChangeOrderDecision`, `ChangeEffect`;
//!   `WorkSnapshot.changeOrders`, by number, each with its decision or
//!   `null`); `ChangeOrderDraft` (with `ChangeEffectDraft`, an effect as the
//!   interface sends it) for `change_order_raise`, `ChangeOrderDecisionDraft`
//!   for `change_order_decide`. An effect is tagged by `kind` — `add`,
//!   `duration`, `remove` — and its fields are camelCase. Amounts are signed
//!   whole minor units (`costCents`, `null` when not priced); days are working
//!   days. The impact on the finish is not computed here: it is the domain's,
//!   sent with the decision and kept as the fact of that moment.
//! - E2: funding — where the money comes from (`Funding`, by position;
//!   `FundingReceipt`, the money received, by `seq`; `WorkSnapshot.funding`,
//!   `WorkSnapshot.fundingReceipts`); `FundingDraft` for `funding_add` and
//!   `funding_update` (written whole: `null` clears `source` and `note`),
//!   `FundingReceiptDraft` for `funding_receipt_add`. A receipt is a fact:
//!   a reversal is the negative of the receipt it reverses, naming it by
//!   `reversesSeq`. Whether the money lasts is not here: it is the domain's,
//!   computed every time.
//! - E3: why a day was lost. `DiaryEntry.lostCause` — `weather`, `decision`,
//!   `absence`, `material`, `owner`, `access` or `other`, `null` when none was
//!   given — and `DiaryEntry.lostPartyPersonId`, the person the day is put
//!   down to, `null` when nobody was named; both `null` for every entry
//!   written before E3. `EntryDraft` gains the same two, optional (left out is
//!   `null`): a cause only on a lost day, a person only with a cause. A cause
//!   is changed by a correction, as everything in the diary. The forecast and
//!   the delay ledger are not here: they are the domain's, computed every time.
//! - E4: snags (`Snag`, `SnagClosure`; `WorkSnapshot.snags`, by number, each
//!   with its closure or `null` while open); `SnagDraft` for `snag_raise`,
//!   `SnagClosureDraft` for `snag_close`. A closure is `fixed` — always with
//!   a photo — or `withdrawn` — always with a note. Photos cross by
//!   `photoHash`, the SHA-256 of an image document of the work, never by a
//!   path. A payment milestone may be earned by `retention`
//!   (`Milestone.trigger`), naming no activity. Whether a snag is overdue and
//!   whether a retention is held or earned are not here: they are the
//!   domain's, computed every time.
//! - G1: the weekly site meeting. `WorkSnapshot.meetings` (`Meeting`, by
//!   number), each with its `attendees` (`MeetingAttendee`: `personId` or
//!   `name`, exactly one), its `items` (`MeetingItem`: `kind`, `refId`,
//!   `title`, `note`, `outcome`) and its `actions` (`MeetingAction`:
//!   `meetingId` — the meeting that raised it — `text`, `personId`, `name`,
//!   `dueOn`), each action with its `closure`
//!   (`MeetingActionClosure`: `meetingId` — `null` when closed between
//!   meetings — `outcome` `done` or `dropped`, `closedOn`, `note`) or `null`
//!   while open: nested, not a separate list. `MinutesDraft` for
//!   `meeting_close` (`heldOn`, `notes`, `attendees: AttendeeDraft[]`,
//!   `items: MeetingItemDraft[]`, `actions: MeetingActionDraft[]`,
//!   `closures: CarriedClosureDraft[]` — the earlier actions closed at this
//!   meeting, on its day); `ActionClosureDraft` for `meeting_action_close`.
//!   The minutes are written once and never edited. The agenda is not here:
//!   it is the domain's, computed every time.

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
#[cfg_attr(test, derive(Deserialize))]
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
    /// The template the plan was started from, by id; `null` for a plan
    /// started empty. Provenance, not a tie: nothing links back to it.
    pub template_id: Option<String>,
    /// That template's version; `null` with the id.
    pub template_version: Option<i64>,
    /// Its title, in the language the work was started in; `null` with the id.
    pub template_title: Option<String>,
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
#[cfg_attr(test, derive(Deserialize))]
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
#[cfg_attr(test, derive(Deserialize))]
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
#[cfg_attr(test, derive(Deserialize))]
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
#[cfg_attr(test, derive(Deserialize))]
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
    /// The lower — optimistic — end of its range, in working days, as a
    /// template gave it or a person typed it (D1); `null` when there is none.
    /// Set with `durationMaxDays`, or neither.
    pub duration_min_days: Option<i64>,
    /// The upper — pessimistic — end of that range, never below the lower;
    /// `null` with it.
    pub duration_max_days: Option<i64>,
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
#[cfg_attr(test, derive(Deserialize))]
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
    /// Care notes (D3): the work's first, then each room's in the rooms'
    /// order, then each stage's in the stages' order; by position within each.
    pub care_notes: Vec<CareNote>,
    /// Change orders (E1), by number, each with its decision or `null` while
    /// it waits for one. Empty before the plan is approved: there are none.
    pub change_orders: Vec<ChangeOrder>,
    /// Where the money comes from (E2): the funds expected, by position.
    pub funding: Vec<Funding>,
    /// The money received (E2): the ledger, by `seq` — reversals included,
    /// as they were written.
    pub funding_receipts: Vec<FundingReceipt>,
    /// Snags (E4), by number, each with its closure or `null` while it is
    /// open.
    pub snags: Vec<Snag>,
    /// The minutes of the site meetings (G1), by number, each with its
    /// attendees, its items and its actions — each action with its closure,
    /// or `null` while it is open.
    pub meetings: Vec<Meeting>,
}

/// A snag (E4, pt "pendência"): a defect or a pending item found near the
/// end, on record — where it is, who must fix it, when it is due, a photo of
/// it. Insert-only: a snag raised by mistake is withdrawn, never deleted.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(test, derive(Deserialize))]
#[serde(rename_all = "camelCase")]
pub struct Snag {
    /// UUID v7.
    pub id: String,
    /// 1, 2, 3 … for the whole work, in the order raised.
    pub number: i64,
    /// What is wrong, 1 to 200 characters.
    pub title: String,
    /// More words, up to 2000 characters; `null` when none.
    pub description: Option<String>,
    /// The stage it is in. Not a tie: a stage removed later leaves the record
    /// as it was.
    pub stage_id: String,
    /// The activity of that stage it is about; `null` for the stage as a
    /// whole. Not a tie either.
    pub activity_id: Option<String>,
    /// The person of the plan who must fix it; `null` for nobody named. Not a
    /// tie either.
    pub person_id: Option<String>,
    /// The day it was raised, `YYYY-MM-DD`.
    pub raised_on: String,
    /// The day it should be fixed by, not before `raisedOn`; `null` when none.
    pub due_on: Option<String>,
    /// A photo of the problem, by the SHA-256 of an image document of the
    /// work; `null` when none.
    pub photo_hash: Option<String>,
    /// The Windows account that raised it.
    pub author_name: String,
    /// When it was raised, UTC.
    pub created_at: String,
    /// How it was closed; `null` while it is open.
    pub closure: Option<SnagClosure>,
}

/// The one closure of a snag (E4): fixed, with a photo of it fixed, or
/// withdrawn, with a note saying why.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(test, derive(Deserialize))]
#[serde(rename_all = "camelCase")]
pub struct SnagClosure {
    /// `fixed` or `withdrawn`.
    pub outcome: String,
    /// The day it was closed, `YYYY-MM-DD`, not before the snag was raised.
    pub closed_on: String,
    /// The photo of it fixed, by hash — always given for `fixed`; `null` or a
    /// photo for `withdrawn`.
    pub photo_hash: Option<String>,
    /// Why, in the person's words — always given for `withdrawn`; `null` when
    /// none.
    pub note: Option<String>,
    /// The Windows account that closed it.
    pub author_name: String,
    /// When it was closed, UTC.
    pub created_at: String,
}

/// A snag as the interface raises it.
#[derive(Debug, Clone, Default, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnagDraft {
    /// `YYYY-MM-DD`, not after today.
    pub raised_on: String,
    /// What is wrong, 1 to 200 characters.
    pub title: String,
    /// More words, up to 2000 characters.
    #[serde(default)]
    pub description: Option<String>,
    /// The stage it is in — a closed stage takes one.
    pub stage_id: String,
    /// An activity of that stage, or `null`.
    #[serde(default)]
    pub activity_id: Option<String>,
    /// Who must fix it: a person of the plan, or `null`.
    #[serde(default)]
    pub person_id: Option<String>,
    /// `YYYY-MM-DD`, not before `raisedOn`, or `null`.
    #[serde(default)]
    pub due_on: Option<String>,
    /// A photo of the problem: the hash of an image document of the work —
    /// the interface adds the file as a document first — or `null`.
    #[serde(default)]
    pub photo_hash: Option<String>,
}

/// A snag's closure as the interface sends it.
#[derive(Debug, Clone, Default, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnagClosureDraft {
    /// The snag's id.
    pub snag_id: String,
    /// `fixed` or `withdrawn`.
    pub outcome: String,
    /// `YYYY-MM-DD`, not after today and not before the snag was raised.
    pub closed_on: String,
    /// The photo of it fixed — required for `fixed` — by the hash of an image
    /// document of the work.
    #[serde(default)]
    pub photo_hash: Option<String>,
    /// Why — required for `withdrawn` — up to 2000 characters.
    #[serde(default)]
    pub note: Option<String>,
}

/// The minutes of a site meeting (G1, pt "ata"): written once, when the
/// meeting is closed, and never edited — a mistake is said in the next
/// meeting's minutes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(test, derive(Deserialize))]
#[serde(rename_all = "camelCase")]
pub struct Meeting {
    /// UUID v7.
    pub id: String,
    /// 1, 2, 3 … for the whole work, in the order held.
    pub number: i64,
    /// The day it was held, `YYYY-MM-DD`, not after the day it was written.
    pub held_on: String,
    /// What was said of the meeting as a whole, up to 4000 characters; `null`
    /// when none.
    pub notes: Option<String>,
    /// Who was there, in the order ticked.
    pub attendees: Vec<MeetingAttendee>,
    /// The agenda as it was taken, in its order.
    pub items: Vec<MeetingItem>,
    /// The actions raised at this meeting, in their order, each with its
    /// closure or `null` while it is open.
    pub actions: Vec<MeetingAction>,
    /// The Windows account that closed the meeting.
    pub author_name: String,
    /// When the minutes were written, UTC.
    pub created_at: String,
}

/// Who was at a meeting: a person of the plan or somebody named — exactly one
/// of the two is given, the other is `null`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(test, derive(Deserialize))]
#[serde(rename_all = "camelCase")]
pub struct MeetingAttendee {
    /// 1, 2, 3 … in the order ticked.
    pub position: i64,
    /// A person of the plan. Not a tie: a person removed later leaves the
    /// minutes as they were.
    pub person_id: Option<String>,
    /// Somebody who is not a person of the plan, 1 to 120 characters.
    pub name: Option<String>,
}

/// An item of a meeting's agenda, as it was taken.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(test, derive(Deserialize))]
#[serde(rename_all = "camelCase")]
pub struct MeetingItem {
    /// 1, 2, 3 … in the agenda's order.
    pub position: i64,
    /// `action-carried`, `decision`, `change`, `snag`, `payment`, `delay`,
    /// `lookahead`, `gate` or `other`.
    pub kind: String,
    /// The id of what it is about — a decision, a change order, a snag, an
    /// action — or `null`. Not a tie.
    pub ref_id: Option<String>,
    /// As the agenda said it, frozen; 1 to 200 characters.
    pub title: String,
    /// What was said, up to 2000 characters; `null` when nothing was written.
    pub note: Option<String>,
    /// What was done in the meeting, in words, up to 200 characters; `null`
    /// when nothing was done.
    pub outcome: Option<String>,
}

/// An action raised at a meeting: what is to be done, on whom, by when. A
/// promise on record, not an obligation the product enforces.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(test, derive(Deserialize))]
#[serde(rename_all = "camelCase")]
pub struct MeetingAction {
    /// UUID v7.
    pub id: String,
    /// The meeting that raised it — the one it is nested in, said again so
    /// an action read on its own still names it.
    pub meeting_id: String,
    /// 1, 2, 3 … in the order written at its meeting.
    pub position: i64,
    /// What is to be done, 1 to 200 characters.
    pub text: String,
    /// The person of the plan it is on; `null` when it is on somebody named or
    /// on nobody. Not a tie.
    pub person_id: Option<String>,
    /// Somebody named it is on; `null` when it is on a person or on nobody.
    pub name: Option<String>,
    /// The day it is due by, not before the meeting; `null` when none.
    pub due_on: Option<String>,
    /// When it was written, UTC.
    pub created_at: String,
    /// How it was closed; `null` while it is open.
    pub closure: Option<MeetingActionClosure>,
}

/// The one closure of an action: done or dropped, at a later meeting or
/// between meetings.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(test, derive(Deserialize))]
#[serde(rename_all = "camelCase")]
pub struct MeetingActionClosure {
    /// The meeting it was closed at; `null` when it was closed between
    /// meetings.
    pub meeting_id: Option<String>,
    /// `done` or `dropped`.
    pub outcome: String,
    /// The day it was closed, `YYYY-MM-DD` — the meeting's day when closed at
    /// one.
    pub closed_on: String,
    /// A note, up to 500 characters; `null` when none.
    pub note: Option<String>,
    /// The Windows account that closed it.
    pub author_name: String,
    /// When it was closed, UTC.
    pub created_at: String,
}

/// The minutes of a meeting as the interface sends them when it is closed:
/// everything written in one go, or nothing.
#[derive(Debug, Clone, Default, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MinutesDraft {
    /// `YYYY-MM-DD`, not after today; not held to the order of the meetings' days.
    pub held_on: String,
    /// Up to 4000 characters, or `null`.
    #[serde(default)]
    pub notes: Option<String>,
    /// Who was there; may be empty.
    #[serde(default)]
    pub attendees: Vec<AttendeeDraft>,
    /// The agenda's items, in order; may be empty.
    #[serde(default)]
    pub items: Vec<MeetingItemDraft>,
    /// The actions raised at this meeting; may be empty.
    #[serde(default)]
    pub actions: Vec<MeetingActionDraft>,
    /// The actions of earlier meetings closed at this one, on its day.
    #[serde(default)]
    pub closures: Vec<CarriedClosureDraft>,
}

/// Who was there: a person of the plan or somebody named — exactly one.
#[derive(Debug, Clone, Default, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttendeeDraft {
    /// A person of the plan, or `null`.
    #[serde(default)]
    pub person_id: Option<String>,
    /// Somebody named, 1 to 120 characters, or `null`.
    #[serde(default)]
    pub name: Option<String>,
}

/// An agenda item as it was taken.
#[derive(Debug, Clone, Default, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MeetingItemDraft {
    /// One of the nine kinds.
    pub kind: String,
    /// The id of what it is about, up to 64 characters, or `null`.
    #[serde(default)]
    pub ref_id: Option<String>,
    /// As the agenda said it, 1 to 200 characters, one line.
    pub title: String,
    /// What was said, up to 2000 characters.
    #[serde(default)]
    pub note: Option<String>,
    /// What was done, in words, up to 200 characters.
    #[serde(default)]
    pub outcome: Option<String>,
}

/// An action as it is raised at the meeting.
#[derive(Debug, Clone, Default, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MeetingActionDraft {
    /// What is to be done, 1 to 200 characters, one line.
    pub text: String,
    /// A person of the plan, or `null`.
    #[serde(default)]
    pub person_id: Option<String>,
    /// Somebody named, or `null` — never with a person.
    #[serde(default)]
    pub name: Option<String>,
    /// `YYYY-MM-DD`, not before the meeting, or `null`.
    #[serde(default)]
    pub due_on: Option<String>,
}

/// An action of an earlier meeting closed at this one, on its day.
#[derive(Debug, Clone, Default, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CarriedClosureDraft {
    /// The action's id.
    pub action_id: String,
    /// `done` or `dropped`.
    pub outcome: String,
    /// Up to 500 characters, or `null`.
    #[serde(default)]
    pub note: Option<String>,
}

/// An action closed between meetings.
#[derive(Debug, Clone, Default, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionClosureDraft {
    /// The action's id.
    pub action_id: String,
    /// `done` or `dropped`.
    pub outcome: String,
    /// `YYYY-MM-DD`, not after today and not before the meeting that raised
    /// it.
    pub closed_on: String,
    /// Up to 500 characters, or `null`.
    #[serde(default)]
    pub note: Option<String>,
}

/// What a change does to the plan (E1), as data the schedule can compute.
/// Tagged by `kind`; its fields are camelCase. Durations are whole working
/// days, 1 to 3650.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ChangeEffect {
    /// A new activity in the change's stage, finish-to-start after `after`.
    Add {
        /// Its name, 1 to 120 characters.
        name: String,
        /// Its duration.
        duration_days: i64,
        /// The activity it starts after, or `null` for none.
        after: Option<String>,
    },
    /// An existing activity's new duration.
    Duration {
        /// The activity.
        activity_id: String,
        /// Its new duration.
        duration_days: i64,
    },
    /// An existing activity dropped — scope reduced.
    Remove {
        /// The activity.
        activity_id: String,
    },
}

/// A change order (E1, pt "aditivo"): a change somebody asked for, on record,
/// with what it costs and what it does to the plan. Insert-only: a mistake is
/// withdrawn and raised again.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(test, derive(Deserialize))]
#[serde(rename_all = "camelCase")]
pub struct ChangeOrder {
    /// UUID v7.
    pub id: String,
    /// 1, 2, 3 … for the whole work, in the order raised.
    pub number: i64,
    /// The day it was raised, `YYYY-MM-DD`.
    pub raised_on: String,
    /// What changes, 1 to 200 characters.
    pub title: String,
    /// More words, up to 2000 characters; `null` when none.
    pub description: Option<String>,
    /// `owner`, `person` or `other`.
    pub asked_by: String,
    /// The person who asked — given exactly when `askedBy` is `person`. Not a
    /// tie: a person removed later leaves the record as it was.
    pub asked_by_person_id: Option<String>,
    /// Who asked, by name — given exactly when `askedBy` is `other`.
    pub asked_by_name: Option<String>,
    /// The stage it lands in. Not a tie either.
    pub stage_id: String,
    /// What it costs, signed whole minor units (a change can save money);
    /// `null` when it was not priced, which is not 0.
    pub cost_cents: Option<i64>,
    /// What it does to the plan, in order; empty for a change of money alone.
    pub effects: Vec<ChangeEffect>,
    /// The Windows account that raised it.
    pub author_name: String,
    /// When it was raised, UTC.
    pub created_at: String,
    /// How it was decided; `null` while it waits.
    pub decision: Option<ChangeOrderDecision>,
}

/// The one decision on a change order (E1), with its impact as the schedule
/// said it the moment it was decided.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(test, derive(Deserialize))]
#[serde(rename_all = "camelCase")]
pub struct ChangeOrderDecision {
    /// `approved`, `declined` or `withdrawn`.
    pub outcome: String,
    /// The day it was decided, `YYYY-MM-DD`.
    pub decided_on: String,
    /// Why, in the person's words; `null` when none.
    pub note: Option<String>,
    /// The finish before the change, as the schedule said that day; `null`
    /// when it could not say.
    pub finish_before: Option<String>,
    /// The finish with the change, as the schedule said that day.
    pub finish_after: Option<String>,
    /// The working days the change moved the finish, signed; `null` when it
    /// could not be counted.
    pub days_delta: Option<i64>,
    /// The change's money, copied from it; `null` when not priced.
    pub cost_cents: Option<i64>,
    /// The replanning the approval was written into; `null` unless approved.
    pub replanning_id: Option<String>,
    /// The Windows account that decided it.
    pub author_name: String,
    /// When it was decided, UTC.
    pub created_at: String,
}

/// An effect as the interface sends it: the fields of every kind, each left
/// out or `null` when the kind has none. Read by the host into a
/// [`ChangeEffect`], so that a kind that is not one is a sentence, not a
/// failure to deserialise.
#[derive(Debug, Clone, Default, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangeEffectDraft {
    /// `add`, `duration` or `remove`.
    pub kind: String,
    /// `add`: the new activity's name.
    #[serde(default)]
    pub name: Option<String>,
    /// `add` and `duration`: whole working days, 1 to 3650.
    #[serde(default)]
    pub duration_days: Option<f64>,
    /// `add`: the activity it starts after, or `null`.
    #[serde(default)]
    pub after: Option<String>,
    /// `duration` and `remove`: the activity.
    #[serde(default)]
    pub activity_id: Option<String>,
}

/// A change order as the interface raises it.
#[derive(Debug, Clone, Default, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangeOrderDraft {
    /// `YYYY-MM-DD`, not after today.
    pub raised_on: String,
    /// What changes, 1 to 200 characters.
    pub title: String,
    /// More words, up to 2000 characters.
    #[serde(default)]
    pub description: Option<String>,
    /// `owner`, `person` or `other`.
    pub asked_by: String,
    /// When a person asked: their id.
    #[serde(default)]
    pub asked_by_person_id: Option<String>,
    /// When somebody else asked: their name, 1 to 120 characters.
    #[serde(default)]
    pub asked_by_name: Option<String>,
    /// The stage it lands in.
    pub stage_id: String,
    /// Signed whole minor units, or `null` when not priced.
    #[serde(default)]
    pub cost_cents: Option<f64>,
    /// What it does to the plan, at most 50; empty for money alone.
    #[serde(default)]
    pub effects: Vec<ChangeEffectDraft>,
}

/// A decision as the interface sends it.
#[derive(Debug, Clone, Default, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangeOrderDecisionDraft {
    /// The change order's id.
    pub id: String,
    /// `approved`, `declined` or `withdrawn`.
    pub outcome: String,
    /// `YYYY-MM-DD`, not after today and not before it was raised.
    pub decided_on: String,
    /// Why, up to 2000 characters.
    #[serde(default)]
    pub note: Option<String>,
    /// The finish before the change, as the schedule says it now.
    #[serde(default)]
    pub finish_before: Option<String>,
    /// The finish with the change.
    #[serde(default)]
    pub finish_after: Option<String>,
    /// The working days between them, signed and whole.
    #[serde(default)]
    pub days_delta: Option<f64>,
}

/// What the owner must know to look after the work — "Reseal the shower grout
/// once a year" — on the work, a room or a stage (D3). Not the plan: editable
/// at any time.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(test, derive(Deserialize))]
#[serde(rename_all = "camelCase")]
pub struct CareNote {
    /// UUID v7.
    pub id: String,
    /// `work`, `room` or `stage`.
    pub target_kind: String,
    /// The room's or the stage's id; for the work, its `workId`.
    pub target_id: String,
    /// Its order among its target's notes: 1, 2, 3 … with no gaps.
    pub position: i64,
    /// What it says, 1 to 1 000 characters.
    pub text: String,
    /// When it was written, UTC.
    pub created_at: String,
}

/// An approved plan being changed, and why. Opened with a reason; closed only
/// by taking the next baseline, which copies the reason. Only the open one
/// crosses the boundary: a closed one lives on as its baseline's `reason`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(test, derive(Deserialize))]
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
#[cfg_attr(test, derive(Deserialize))]
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
    /// `photo`, `quote`, `drawing`, `permit`, `receipt`, `contract`,
    /// `warranty`, `manual` or `other`.
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
#[cfg_attr(test, derive(Deserialize))]
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
    /// How much, in the currency's minor unit; 0 or more — or `null`: not
    /// priced yet, which is not 0.
    pub amount_cents: Option<i64>,
}

/// A change to a cost line. A field left out is left alone.
#[derive(Debug, Clone, Default, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CostLinePatch {
    /// A new label.
    #[serde(default)]
    pub label: Option<String>,
    /// Absent: unchanged. `null`: not priced yet. A number: a new amount,
    /// whole minor units, 0 or more.
    #[serde(default, deserialize_with = "present")]
    pub amount_cents: Option<Option<f64>>,
}

/// Committed money: a quote or contract accepted.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(test, derive(Deserialize))]
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
    /// removed, and neither can its payment plan.
    pub locked: bool,
    /// Its payment plan (D2), by position; empty when it has none — "no
    /// payment plan", which the domain never assumes earned or not.
    pub milestones: Vec<Milestone>,
}

/// One milestone of a commitment's payment plan (D2): a share of its amount,
/// earned by a fact of the work — never a date, never a tick. What is earned
/// is the domain's, computed from the stage's lifecycle and the diary.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(test, derive(Deserialize))]
#[serde(rename_all = "camelCase")]
pub struct Milestone {
    /// UUID v7.
    pub id: String,
    /// Its order in the plan: 1, 2, 3 … with no gaps.
    pub position: i64,
    /// What it is, in the person's words.
    pub label: String,
    /// Its share of the commitment's amount, in basis points: 1 to 10 000
    /// ("30 %" is 3000). A plan's shares add up to at most 10 000.
    pub share_bp: i64,
    /// The fact that earns it: `advance` (the day the commitment was agreed),
    /// `stage_started`, `activity_finished`, `stage_closed`, or (E4)
    /// `retention` — held back until the stage is closed and every snag of it
    /// on the commitment's person is closed.
    pub trigger: String,
    /// The activity whose finish earns it — given exactly when the trigger is
    /// `activity_finished`, and of the commitment's stage; `null` otherwise.
    pub activity_id: Option<String>,
}

/// A change to a milestone, while nothing is paid against its commitment. A
/// field left out is left alone. The milestone the patch leaves must still
/// name an activity exactly when its trigger is `activity_finished`: moving
/// away from that trigger sends `activityId: null` with it.
#[derive(Debug, Clone, Default, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MilestonePatch {
    /// A new label.
    #[serde(default)]
    pub label: Option<String>,
    /// A new share, whole basis points, 1 to 10 000.
    #[serde(default)]
    pub share_bp: Option<f64>,
    /// A new trigger.
    #[serde(default)]
    pub trigger: Option<String>,
    /// Absent: unchanged. `null`: none. A string: an activity of the
    /// commitment's stage.
    #[serde(default, deserialize_with = "present")]
    pub activity_id: Option<Option<String>>,
}

/// The labels of the usual payment plan, in the person's language — the
/// interface's words, written as they are sent (each checked as a label).
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsualLabels {
    /// The 30 % earned when the stage starts.
    pub started: String,
    /// The 40 % earned when the stage's last activity is finished.
    pub finished: String,
    /// The 30 % earned when the stage closes.
    pub closed: String,
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
#[cfg_attr(test, derive(Deserialize))]
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

/// A fund expected (E2, pt "recursos"): money the work will receive, from
/// where and when. Plan, not fact: edited freely, and not locked by the plan's
/// approval. Removable only while no receipt names it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(test, derive(Deserialize))]
#[serde(rename_all = "camelCase")]
pub struct Funding {
    /// UUID v7.
    pub id: String,
    /// Its order among the work's funds: 1, 2, 3 … with no gaps.
    pub position: i64,
    /// What it is, 1 to 200 characters.
    pub label: String,
    /// Where it comes from, up to 200 characters; `null` when not said.
    pub source: Option<String>,
    /// How much is expected, in the currency's minor unit; more than 0.
    pub amount_cents: i64,
    /// The day it is expected, `YYYY-MM-DD`.
    pub expected_on: String,
    /// More words, up to 2000 characters; `null` when none.
    pub note: Option<String>,
}

/// A fund as the interface sends it — to add one, or to write one whole.
#[derive(Debug, Clone, Default, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FundingDraft {
    /// The fund to change, for `funding_update`; left out or `null` for
    /// `funding_add`.
    #[serde(default)]
    pub id: Option<String>,
    /// What it is, 1 to 200 characters.
    pub label: String,
    /// Where it comes from, up to 200 characters; `null` for none.
    #[serde(default)]
    pub source: Option<String>,
    /// How much, whole minor units, more than 0.
    pub amount_cents: f64,
    /// `YYYY-MM-DD` — any day, past or to come.
    pub expected_on: String,
    /// More words, up to 2000 characters; `null` for none.
    #[serde(default)]
    pub note: Option<String>,
}

/// Money received (E2): one line of the ledger — never edited. A reversal is
/// a receipt with the negative amount of the one it reverses, naming it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(test, derive(Deserialize))]
#[serde(rename_all = "camelCase")]
pub struct FundingReceipt {
    /// UUID v7.
    pub id: String,
    /// 1, 2, 3 … for the whole work, in the order written.
    pub seq: i64,
    /// The day the money arrived (for a reversal, the day it was undone);
    /// never after the day it was recorded.
    pub day: String,
    /// The fund it belongs to; `null` for money that arrived unplanned.
    pub funding_id: Option<String>,
    /// How much, in the currency's minor unit: positive for money received,
    /// negative for a reversal.
    pub amount_cents: i64,
    /// A few words, up to 200 characters; `null` when none.
    pub note: Option<String>,
    /// The receipt this one reverses; `null` for money received.
    pub reverses_seq: Option<i64>,
    /// The Windows account that recorded it.
    pub author_name: String,
    /// When it was recorded, UTC.
    pub created_at: String,
}

/// Money received, as the interface sends it.
#[derive(Debug, Clone, Default, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FundingReceiptDraft {
    /// The fund it belongs to; `null` for money that arrived unplanned.
    #[serde(default)]
    pub funding_id: Option<String>,
    /// How much, whole minor units, more than 0.
    pub amount_cents: f64,
    /// `YYYY-MM-DD`, not after today.
    pub day: String,
    /// A few words, up to 200 characters.
    #[serde(default)]
    pub note: Option<String>,
}

/// A question a stage must answer at one of its gates.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(test, derive(Deserialize))]
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
    /// Whether a "yes" must carry a photo of the work (D3): hidden work,
    /// photographed before it is closed.
    pub needs_photo: bool,
}

/// One answer to a check — a fact, never rewritten.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(test, derive(Deserialize))]
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
#[cfg_attr(test, derive(Deserialize))]
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
    /// The lower end of the lead range a template gave; `null` when there is
    /// none. Set with `leadMaxDays`, or neither. For display: the lead time
    /// is the one above.
    pub lead_min_days: Option<i64>,
    /// The upper end of that range — what the lead time started as.
    pub lead_max_days: Option<i64>,
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
#[cfg_attr(test, derive(Deserialize))]
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
#[cfg_attr(test, derive(Deserialize))]
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
#[cfg_attr(test, derive(Deserialize))]
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
#[cfg_attr(test, derive(Deserialize))]
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
    /// The optimistic end of the activity's range (D1). Sent with
    /// `durationMaxDays` or not at all: both absent, unchanged; both `null`,
    /// no range; two numbers, whole working days from 1 to 3650, this one not
    /// above the other, and the duration — held, or sent beside them — not
    /// outside them. Not locked by approval: a baseline does not record it.
    #[serde(default, deserialize_with = "present")]
    pub duration_min_days: Option<Option<f64>>,
    /// The pessimistic end of the range, with `durationMinDays` (D1).
    #[serde(default, deserialize_with = "present")]
    pub duration_max_days: Option<Option<f64>>,
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
    /// Why no work was possible (E3): `weather`, `decision`, `absence`,
    /// `material`, `owner`, `access`, `other`, or `null`. Only on a lost day.
    #[serde(default)]
    pub lost_cause: Option<String>,
    /// The person the lost day is put down to, by id (E3); `null` when nobody.
    /// Only with a cause.
    #[serde(default)]
    pub lost_party_person_id: Option<String>,
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
#[cfg_attr(test, derive(Deserialize))]
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
#[cfg_attr(test, derive(Deserialize))]
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
#[cfg_attr(test, derive(Deserialize))]
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
    /// Why no work was possible (E3); `null` when no cause was given — and for
    /// every entry written before E3.
    pub lost_cause: Option<String>,
    /// The person the lost day is put down to, by id — who may since have been
    /// removed from the plan; `null` when nobody was named.
    pub lost_party_person_id: Option<String>,
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

/// A plan to apply whole to a work that has none: what a template becomes
/// once the domain has read it in one language (`applyTemplate`). Rows name
/// one another by local keys, never by ids; the host gives every row a new id
/// and resolves every key, or refuses the whole plan. A list left out is
/// empty.
#[derive(Debug, Clone, Default, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanDraft {
    /// Rooms, in order.
    #[serde(default)]
    pub rooms: Vec<RoomDraft>,
    /// Stages, in order, each with what belongs to it.
    #[serde(default)]
    pub stages: Vec<StageDraft>,
    /// Dependencies, by keys.
    #[serde(default)]
    pub links: Vec<LinkDraft>,
}

/// A room of a [`PlanDraft`].
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoomDraft {
    /// Unique among the draft's rooms, 1 to 64 characters.
    pub key: String,
    /// Its name.
    pub name: String,
}

/// A stage of a [`PlanDraft`].
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StageDraft {
    /// Unique among the draft's stages, 1 to 64 characters.
    pub key: String,
    /// Its name.
    pub name: String,
    /// Its activities, in order.
    #[serde(default)]
    pub activities: Vec<ActivityDraft>,
    /// Its checks, in order within each gate.
    #[serde(default)]
    pub checks: Vec<CheckDraft>,
    /// Its cost lines, in order.
    #[serde(default)]
    pub cost_lines: Vec<CostLineDraft>,
    /// Its decisions, in order.
    #[serde(default)]
    pub decisions: Vec<DecisionDraft>,
}

/// An activity of a [`StageDraft`].
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityDraft {
    /// Unique inside its stage, 1 to 64 characters.
    pub key: String,
    /// Its name.
    pub name: String,
    /// Working days, 1 to 3650; `null` while the range is a range.
    #[serde(default)]
    pub duration_days: Option<f64>,
    /// The lower end of its range, 1 to 3650; with the upper, or neither.
    #[serde(default)]
    pub duration_min_days: Option<f64>,
    /// The upper end, not below the lower.
    #[serde(default)]
    pub duration_max_days: Option<f64>,
    /// The rooms it touches, by the draft's room keys.
    #[serde(default)]
    pub rooms: Vec<String>,
}

/// A check of a [`StageDraft`].
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckDraft {
    /// `start` or `close`.
    pub gate: String,
    /// The question, at most 200 characters.
    pub name: String,
    /// Whether a "yes" must carry a photo (D3); `false` when left out.
    #[serde(default)]
    pub needs_photo: bool,
}

/// A cost line of a [`StageDraft`].
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CostLineDraft {
    /// What it is for.
    pub label: String,
    /// An activity of the same stage, by key; `null` for the stage itself.
    #[serde(default)]
    pub activity_key: Option<String>,
    /// Whole minor units, 0 or more; `null`: not priced yet.
    #[serde(default)]
    pub amount_cents: Option<f64>,
}

/// A decision of a [`StageDraft`].
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DecisionDraft {
    /// What is to be decided.
    pub name: String,
    /// Working days, 0 to 3650 — the upper end of the range, when there is one.
    #[serde(default)]
    pub lead_time_days: f64,
    /// The lower end of its lead range; with the upper, or neither.
    #[serde(default)]
    pub lead_min_days: Option<f64>,
    /// The upper end, not below the lower.
    #[serde(default)]
    pub lead_max_days: Option<f64>,
    /// The activity of the same stage that needs it, by key; `null` for the
    /// stage's first. Resolved — a key that is not there refuses the plan —
    /// and not stored: in 1.0 a decision is needed by its whole stage.
    #[serde(default)]
    pub needs_key: Option<String>,
}

/// One end of a [`LinkDraft`]: a stage, or an activity of a stage, by keys.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EndpointDraft {
    /// `activity` or `stage`.
    pub kind: String,
    /// The stage, or the activity's stage.
    pub stage_key: String,
    /// The activity, for `activity`; `null` for `stage`.
    #[serde(default)]
    pub activity_key: Option<String>,
}

/// A dependency of a [`PlanDraft`], by keys.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkDraft {
    /// What has to finish first.
    pub blocker: EndpointDraft,
    /// What waits for it.
    pub blocked: EndpointDraft,
    /// Working days between the two, 0 to 3650.
    #[serde(default)]
    pub lag_days: f64,
}

/// Where a plan came from: recorded on the work, never linked back.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Provenance {
    /// The template's id: kebab-case, at most 64 characters.
    pub template_id: String,
    /// Its version, a whole number from 1.
    pub template_version: f64,
    /// Its title in the language the work starts in, at most 120 characters.
    pub template_title: String,
}

/// What `work_create` may carry: a plan to apply in the same step.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanStart {
    /// The plan.
    pub draft: PlanDraft,
    /// Where it came from.
    pub provenance: Provenance,
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
    /// Every migration applied, in order (F11).
    pub migrations: Vec<MigrationApplied>,
}

/// One migration a database has been through: its number and its name
/// (`3`, `003_backups`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationApplied {
    /// Its number — the schema version it produced.
    pub number: i64,
    /// Its name, as its file is named.
    pub name: String,
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
    /// Every migration applied, in order (F11).
    pub migrations: Vec<MigrationApplied>,
    /// `wal`.
    pub journal_mode: String,
    /// `off`, `normal`, `full` or `extra`.
    pub synchronous: String,
    /// Whether references are enforced.
    pub foreign_keys: bool,
}

/// What a report or export command wrote. The document a report is written
/// from is `report::model::ReportDocument`, next to the layout that reads it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WrittenFile {
    /// The file, as the command was given it.
    pub path: String,
    /// Its size.
    pub bytes: u64,
    /// How many pages, for a PDF; absent for a CSV, a JSON or an HTML file.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pages: Option<usize>,
}

/// What `backup_write` wrote (F11).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupWritten {
    /// The backup, as the command was given it.
    pub path: String,
    /// Its size.
    pub bytes: u64,
    /// The work's files it holds: the database, every document, every
    /// thumbnail.
    pub files: usize,
    /// Files in `documents/` or `thumbnails/` it does not hold, because a
    /// backup never holds their names — `documents/<name>`; usually none.
    pub left_out: Vec<String>,
}

/// What `backup_inspect` read from a backup's manifest, before anything is
/// restored — every name, the manifest's own hash and every declared size
/// checked; no file inflated (F11).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupSummary {
    /// The work's name when it was backed up.
    pub work_name: String,
    /// Its UUID.
    pub work_id: String,
    /// When the backup was written, UTC.
    pub created_at: String,
    /// The build that wrote it: "Ridgebeam 0.1.0".
    pub app: String,
    /// The work's schema version then.
    pub schema_version: i64,
    /// The work's files it holds.
    pub files: usize,
    /// Their bytes, as restored.
    pub bytes: u64,
    /// The backup file's own size.
    pub archive_bytes: u64,
    /// The folder the recent list knows this work at, or `null`: restoring
    /// moves that row to the new folder, and leaves the old folder as it is.
    pub recent_folder: Option<String>,
}

/// What `backup_restore` restored (F11). The work is open afterwards.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Restored {
    /// The work's UUID.
    pub work_id: String,
    /// The new folder it is in.
    pub folder: String,
    /// Its diary's entries.
    pub entries: i64,
    /// Whether the diary's chain verified.
    pub chain_ok: bool,
    /// How many documents were re-read.
    pub documents: i64,
    /// Documents whose bytes are not the ones recorded.
    pub mismatched: Vec<MismatchedDocument>,
    /// Documents whose file the backup did not hold.
    pub missing: Vec<MissingDocument>,
    /// The folder the recent list knew this work at before, when another —
    /// left as it was — or `null`.
    pub moved_recent_from: Option<String>,
}

/// The last backup of the open work (F11); `backup_last` answers `null` for
/// never.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupLast {
    /// The day it was written, on this computer's calendar.
    pub day: String,
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
    fn a_range_in_a_patch_tells_left_out_from_null_from_a_number() {
        let left_out: ActivityPatch = serde_json::from_value(json!({ "name": "Tiling" })).unwrap();
        assert_eq!(
            (left_out.duration_min_days, left_out.duration_max_days),
            (None, None)
        );

        let cleared: ActivityPatch =
            serde_json::from_value(json!({ "durationMinDays": null, "durationMaxDays": null }))
                .unwrap();
        assert_eq!(
            (cleared.duration_min_days, cleared.duration_max_days),
            (Some(None), Some(None))
        );

        let set: ActivityPatch =
            serde_json::from_value(json!({ "durationMinDays": 2, "durationMaxDays": 4 })).unwrap();
        assert_eq!(
            (set.duration_min_days, set.duration_max_days),
            (Some(Some(2.0)), Some(Some(4.0)))
        );

        let half: ActivityPatch =
            serde_json::from_value(json!({ "durationMinDays": 2.5, "durationMaxDays": 4 }))
                .unwrap();
        assert_eq!(
            half.duration_min_days,
            Some(Some(2.5)),
            "a fraction arrives, so the host can refuse it with a sentence"
        );
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
            duration_min_days: Some(3),
            duration_max_days: Some(5),
            responsible_id: None,
            room_ids: vec![],
            quantity: Some(12.0),
            unit: Some("m²".into()),
        };
        assert_eq!(
            serde_json::to_value(activity).unwrap(),
            json!({
                "id": "a", "stageId": "s", "position": 1, "name": "Tiling",
                "durationDays": null, "durationMinDays": 3, "durationMaxDays": 5,
                "responsibleId": null,
                "roomIds": [], "quantity": 12.0, "unit": "m²"
            })
        );
    }
}
