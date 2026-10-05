/**
 * The typed client for the host: one function per command, and nothing else.
 *
 * This is the only file that knows `@tauri-apps/api` exists. Every command name and every
 * top-level argument key is the host's snake_case (`activity_add({ stage_id, name })`); every shape
 * inside is its serde camelCase (`src-tauri/src/contract.rs`), written once here so that no
 * component ever spells a command. The plan's shapes are the domain's (`@/domain/plan`), because the domain
 * reads the snapshot exactly as the host hands it over.
 *
 * There is no command here that sets progress, and there never will be: progress is derived
 * from the diary (SPEC §2.6). Every plan command answers with the whole `WorkSnapshot` — the F0
 * scale is small enough that the screen never has to guess what changed.
 */

import { invoke } from '@tauri-apps/api/core';

import type { DiaryEntry, EntryDraft } from '@/domain/diary';
import type { Direction } from '@/domain/ordering';
import type {
  Answer,
  CareTargetKind,
  ChangeAskedBy,
  ChangeEffect,
  ChangeOrderOutcome,
  DocumentKind,
  Endpoint,
  Gate,
  Holiday,
  MeetingActionOutcome,
  MeetingItemKind,
  MilestoneTrigger,
  PurchaseEventKind,
  SnagOutcome,
  TargetKind,
  WorkSnapshot,
} from '@/domain/plan';
import type { PlanDraft, Provenance } from '@/domain/templates/format';
import {
  readLanguage,
  readLens,
  readTheme,
  type LanguageChoice,
  type LensChoice,
  type ThemeChoice,
} from '@/domain/settings';

export type { WorkSnapshot };

// ── Shapes ───────────────────────────────────────────────────────────────────

/** What the running binary says about itself. */
export interface SystemInfo {
  product: string;
  version: string;
  os: string;
  arch: string;
  appDataDir: string;
  /** True when `RIDGEBEAM_DATA_DIR` moved the application data (debug builds only). */
  databaseRelocated: boolean;
}

/** The person's choices, kept in the application database. */
export interface Settings {
  language: LanguageChoice;
  theme: ThemeChoice;
  lens: LensChoice;
}

/** The keys `settings_set` accepts. The host refuses any other with `settings_key`. */
export type SettingKey = keyof Settings;

/** A work the application database remembers having opened. */
export interface RecentWork {
  workId: string;
  name: string;
  folder: string;
  /** UTC, milliseconds, trailing `Z`. */
  openedAt: string;
  /** False when the folder is no longer where it was. */
  present: boolean;
}

/** What a new work starts from. */
export interface WorkDraft {
  name: string;
  place: string;
  /** `YYYY-MM-DD`. */
  startDate: string;
  /** ISO 4217. */
  currency: string;
  /** Seven characters, Monday first: `1111100`. */
  workingDays: string;
  hoursPerDay: number;
}

/** The open work, named. */
export interface WorkSummary {
  workId: string;
  name: string;
  folder: string;
}

export interface WorkPatch {
  name?: string;
  place?: string;
  startDate?: string;
  currency?: string;
}

export interface CalendarDraft {
  workingDays: string;
  hoursPerDay: number;
}

/**
 * What may change on an activity. An absent field is left alone; `null` says "not known",
 * which is how a duration or a responsible is taken back. A duration is a JSON number — a whole
 * number of working days — never a string.
 */
export type ActivityPatch = ActivityFields & RangePatch;

interface ActivityFields {
  name?: string;
  durationDays?: number | null;
  responsibleId?: string | null;
  /** Zero or more, finite; `null` clears it — and clears the unit with it. */
  quantity?: number | null;
  /** Up to 16 characters; a unit needs a quantity, and empty is `null`. */
  unit?: string | null;
}

/**
 * An activity's range — its optimistic and pessimistic working days (D1, ADR-035) — is sent **both
 * or neither**: the host refuses one end alone. Whole numbers 1..3650, the optimistic no more than
 * the pessimistic, and the duration, when there is one, between them; `null` for both clears the
 * range. Unlike the duration, a range is not locked by approval: it is an estimate of uncertainty,
 * not the plan, and no baseline records it.
 */
type RangePatch =
  | { durationMinDays?: never; durationMaxDays?: never }
  | { durationMinDays: number; durationMaxDays: number }
  | { durationMinDays: null; durationMaxDays: null };

/**
 * One activity as the schedule places it now — a row of the baseline being taken. The schedule is
 * the domain's, so the interface sends where each activity falls; the host reads the name, the
 * stage and the duration from the file itself, so a baseline records what the work held.
 */
export interface BaselineRowDraft {
  activityId: string;
  /** `YYYY-MM-DD`, or `null` when the schedule could not place it. */
  start: string | null;
  finish: string | null;
}

/** One migration a database has been through: its number and its file's name (`003_backups`). */
export interface MigrationApplied {
  number: number;
  name: string;
}

/** The files and pragmas Diagnostics shows, read back from the connections. */
export interface Diagnostics {
  app: { databasePath: string; schemaVersion: number; migrations: MigrationApplied[] };
  work: null | {
    folder: string;
    databasePath: string;
    schemaVersion: number;
    /** Every migration this work's database has been through, in order (F11). */
    migrations: MigrationApplied[];
    /** `wal`. */
    journalMode: string;
    /** `off`, `normal`, `full` or `extra`. */
    synchronous: string;
    foreignKeys: boolean;
  };
}

/** The Windows accent ramp, for the token layer. */
export interface AccentRamp {
  accent: string;
  light1: string;
  light2: string;
  light3: string;
  dark1: string;
  dark2: string;
  dark3: string;
  /** False when this is the built-in default rather than the person's Windows setting. */
  fromSystem: boolean;
}

/** The bounds the host keeps (it trims, and refuses beyond these with `invalid_input`). */
export const LIMITS = {
  name: 120,
  place: 200,
  unit: 16,
  answer: 500,
  entryNote: 4000,
  entryText: 2000,
  doneNote: 500,
  checkName: 200,
  answerReason: 500,
  trade: 60,
  phone: 40,
  email: 120,
  personNote: 500,
  availability: 200,
  documentTitle: 200,
  costLabel: 120,
  whatFor: 200,
  durationDays: 3650,
  hoursPerDay: 24,
  replanReason: 2000,
  careNote: 1000,
  changeTitle: 200,
  changeDescription: 2000,
  changeAskedByName: 120,
  changeNote: 2000,
  changeEffects: 50,
  /** An added activity's name: an activity's name, as the host keeps it. */
  changeEffectName: 120,
  /** A funding row's name, where it comes from and its note; a receipt's note (E2). */
  fundingLabel: 200,
  fundingSource: 200,
  fundingNote: 2000,
  receiptNote: 200,
  /** A snag's title, its description, and the note of its closure — the reason of a withdrawal (E4). */
  snagTitle: 200,
  snagDescription: 2000,
  snagNote: 2000,
  /** A meeting's notes, an item's note and outcome, an action's text, a named attendee (G1). */
  meetingNotes: 4000,
  meetingItemTitle: 200,
  meetingItemNote: 2000,
  meetingItemOutcome: 200,
  meetingActionText: 200,
  meetingClosureNote: 500,
  /** A purchase's name, quantity, supplier and note; an event's note (G2). */
  purchaseName: 200,
  purchaseQuantity: 60,
  purchaseSupplier: 120,
  purchaseNote: 2000,
  purchaseLeadDays: 365,
  purchaseEventNote: 500,
} as const;

// ── The application ──────────────────────────────────────────────────────────

export function systemInfo(): Promise<SystemInfo> {
  return invoke<SystemInfo>('system_info');
}

export function accentRamp(): Promise<AccentRamp> {
  return invoke<AccentRamp>('accent_ramp');
}

export function diagnostics(): Promise<Diagnostics> {
  return invoke<Diagnostics>('diagnostics');
}

/**
 * Read whatever the host holds as the settings this build understands. Reading forgives — a
 * value a newer build wrote falls back to the default — and writing does not: the host's
 * refusal is shown in its own sentence.
 */
function readSettings(raw: Partial<Record<SettingKey, unknown>> | null | undefined): Settings {
  return {
    language: readLanguage(raw?.language),
    theme: readTheme(raw?.theme),
    lens: readLens(raw?.lens),
  };
}

/** What the window uses when the host cannot answer: every default. */
export const BUILT_IN_SETTINGS: Settings = readSettings(null);

export async function settingsGet(): Promise<Settings> {
  return readSettings(await invoke<Partial<Record<SettingKey, unknown>>>('settings_get'));
}

export async function settingsSet(key: SettingKey, value: string): Promise<Settings> {
  return readSettings(
    await invoke<Partial<Record<SettingKey, unknown>>>('settings_set', { key, value }),
  );
}

export function recentWorks(): Promise<RecentWork[]> {
  return invoke<RecentWork[]>('recent_works');
}

// ── The work ─────────────────────────────────────────────────────────────────

export type { PlanDraft, Provenance };

/**
 * A plan to write with a new work, or onto an empty one: the domain's draft, and where it came from
 * (F9, ADR-029) — recorded on the work, never linked back: the work is its own from the first row.
 */
export interface PlanToApply {
  draft: PlanDraft;
  provenance: Provenance;
}

/**
 * Create a work, and — when `plan` is given — write that plan into it in the same step. A plan the
 * host refuses leaves nothing behind: the folder it created is removed again and no recent row is
 * kept.
 */
export function workCreate(
  folder: string,
  draft: WorkDraft,
  plan?: PlanToApply,
): Promise<WorkSummary> {
  return invoke<WorkSummary>(
    'work_create',
    plan === undefined ? { folder, draft } : { folder, draft, plan },
  );
}

export function workOpen(folder: string): Promise<WorkSummary> {
  return invoke<WorkSummary>('work_open', { folder });
}

export async function workClose(): Promise<void> {
  await invoke<null>('work_close');
}

export function workCurrent(): Promise<WorkSummary | null> {
  return invoke<WorkSummary | null>('work_current');
}

export function workGet(): Promise<WorkSnapshot> {
  return invoke<WorkSnapshot>('work_get');
}

export function workUpdate(patch: WorkPatch): Promise<WorkSnapshot> {
  return invoke<WorkSnapshot>('work_update', { patch });
}

export function calendarSet(
  calendar: CalendarDraft,
  holidays: readonly Holiday[],
): Promise<WorkSnapshot> {
  return invoke<WorkSnapshot>('calendar_set', { calendar, holidays });
}

// ── The plan ─────────────────────────────────────────────────────────────────
//
// Every move is one place up or down among its siblings; at an edge the host does nothing and
// answers with the plan as it was (never an error). Positions come back renumbered 1..n.

export function personAdd(name: string): Promise<WorkSnapshot> {
  return invoke<WorkSnapshot>('person_add', { name });
}

/** What may change on a person: the name, and (F6) the trade money is grouped by. */
export interface PersonPatch {
  name?: string;
  /** `null` or empty clears it. */
  trade?: string | null;
  /** Stored as typed and never used to reach anybody: the product has no network (F7). */
  phone?: string | null;
  email?: string | null;
  note?: string | null;
  availability?: string | null;
}

export function personUpdate(id: string, patch: PersonPatch): Promise<WorkSnapshot> {
  return invoke<WorkSnapshot>('person_update', { id, patch });
}

/** The activities this person answered for are left with no responsible. */
export function personRemove(id: string): Promise<WorkSnapshot> {
  return invoke<WorkSnapshot>('person_remove', { id });
}

export function roomAdd(name: string): Promise<WorkSnapshot> {
  return invoke<WorkSnapshot>('room_add', { name });
}

export function roomRename(id: string, name: string): Promise<WorkSnapshot> {
  return invoke<WorkSnapshot>('room_rename', { id, name });
}

/** The activities that touched it stay; they no longer touch it. */
export function roomRemove(id: string): Promise<WorkSnapshot> {
  return invoke<WorkSnapshot>('room_remove', { id });
}

export function roomMove(id: string, direction: Direction): Promise<WorkSnapshot> {
  return invoke<WorkSnapshot>('room_move', { id, direction });
}

export function stageAdd(name: string): Promise<WorkSnapshot> {
  return invoke<WorkSnapshot>('stage_add', { name });
}

export function stageRename(id: string, name: string): Promise<WorkSnapshot> {
  return invoke<WorkSnapshot>('stage_rename', { id, name });
}

export function stageRemove(id: string): Promise<WorkSnapshot> {
  return invoke<WorkSnapshot>('stage_remove', { id });
}

export function stageMove(id: string, direction: Direction): Promise<WorkSnapshot> {
  return invoke<WorkSnapshot>('stage_move', { id, direction });
}

export function activityAdd(stageId: string, name: string): Promise<WorkSnapshot> {
  return invoke<WorkSnapshot>('activity_add', { stage_id: stageId, name });
}

export function activityUpdate(id: string, patch: ActivityPatch): Promise<WorkSnapshot> {
  return invoke<WorkSnapshot>('activity_update', { id, patch });
}

export function activityRemove(id: string): Promise<WorkSnapshot> {
  return invoke<WorkSnapshot>('activity_remove', { id });
}

/** Within its stage. */
export function activityMove(id: string, direction: Direction): Promise<WorkSnapshot> {
  return invoke<WorkSnapshot>('activity_move', { id, direction });
}

/** Replace the rooms an activity touches with exactly these. */
export function activitySetRooms(id: string, roomIds: readonly string[]): Promise<WorkSnapshot> {
  return invoke<WorkSnapshot>('activity_set_rooms', { id, room_ids: roomIds });
}

// ── Dependencies and baselines (F2) ──────────────────────────────────────────

/**
 * `blocked` cannot start until `blocker` has finished, plus `lagDays` working days of waiting.
 * Either end is an activity or a whole stage. A loop is refused by the host with the
 * `dependency_cycle` kind and the chain by name — after the interface has already refused it.
 */
export function dependencyAdd(
  blocker: Endpoint,
  blocked: Endpoint,
  lagDays: number,
): Promise<WorkSnapshot> {
  return invoke<WorkSnapshot>('dependency_add', { blocker, blocked, lag_days: lagDays });
}

export function dependencyUpdate(id: string, lagDays: number): Promise<WorkSnapshot> {
  return invoke<WorkSnapshot>('dependency_update', { id, lag_days: lagDays });
}

export function dependencyRemove(id: string): Promise<WorkSnapshot> {
  return invoke<WorkSnapshot>('dependency_remove', { id });
}

/**
 * Approve the plan as it is scheduled now: the next baseline, numbered by the host. Insert-only —
 * there is no command that edits or removes a baseline, and there never will be.
 */
export function baselineTake(
  rows: readonly BaselineRowDraft[],
  finishDate: string | null,
): Promise<WorkSnapshot> {
  return invoke<WorkSnapshot>('baseline_take', { rows, finish_date: finishDate });
}

/**
 * Open a replanning: say why the approved plan must change (F8, ADR-027). Until one is open, the host
 * refuses every edit to what a baseline records with `plan_approved`; once it is, the plan may be
 * edited, and the replanning is closed only by taking the next baseline, which keeps this reason.
 * The host refuses a blank reason, a plan not yet approved, and a second open replanning.
 */
export function replanOpen(reason: string): Promise<WorkSnapshot> {
  return invoke<WorkSnapshot>('replan_open', { reason });
}

// ── Templates (F9) ───────────────────────────────────────────────────────────
//
// A template is data, applied once as the work's own plan (ADR-029). The library ships inside the
// frontend (`src/data/library.ts`); a template from a file is read by the host as text and parsed
// and validated by the domain — the host never interprets it.

/**
 * Write a template's plan into the open work, in one transaction. Only onto a work with no stage
 * that is not approved; the host refuses anything else, and a cycle, with its own sentence.
 */
export function planApply(draft: PlanDraft, provenance: Provenance): Promise<WorkSnapshot> {
  return invoke<WorkSnapshot>('plan_apply', { draft, provenance });
}

/**
 * Give every activity that has a range and no duration the lower or the upper end of its range as
 * its duration — an explicit act by the person, locked after approval like any duration edit.
 */
export function rangesTake(which: 'low' | 'high'): Promise<WorkSnapshot> {
  return invoke<WorkSnapshot>('ranges_take', { which });
}

/** A template file's text: `.json` only, up to 1 MiB, refused otherwise with a sentence. */
export function templateRead(path: string): Promise<string> {
  return invoke<string>('template_read', { path });
}

/**
 * Write a template file: `.json` only, whole or not at all, up to 1 MiB. An existing file is
 * replaced only with `overwrite`, which the interface sends when the save dialog chose the path —
 * the dialog asked first; a path typed into the field never replaces a file.
 */
export async function templateWrite(path: string, text: string, overwrite: boolean): Promise<void> {
  await invoke<unknown>('template_write', { path, text, overwrite });
}

// ── My templates (G3) ────────────────────────────────────────────────────────
//
// The person's own templates: files in a folder of the application data, each named by its id. The
// interface names a template by its id, never by a path — the host builds the path itself. The text
// is the domain's to parse and check, as any template file's is.

/** A template of the person's own, as the host found it: exactly one of `text` and `problem`. */
export interface MyTemplate {
  /** The file's name without `.json`: the id it is saved and removed by. */
  id: string;
  /** The file's text, for the domain to check; `null` when it was not read. */
  text: string | null;
  /** Why it was not read, as the host's sentence; `null` when it was. */
  problem: string | null;
}

/** What is in the folder: the first 200 by id, and how many more were not listed. */
export interface MyTemplates {
  templates: MyTemplate[];
  notListed: number;
  /** The host's sentence saying how many were not listed; `null` when every one was. */
  note: string | null;
}

/** Every template in the person's folder. A folder not there yet is an empty list. */
export async function myTemplatesList(): Promise<MyTemplates> {
  const answer = await invoke<MyTemplates | MyTemplate[]>('my_templates_list');
  // The one place the answer's shape is known: a bare list is read as one with nothing left out.
  return Array.isArray(answer) ? { templates: answer, notListed: 0, note: null } : answer;
}

/**
 * Save a template among the person's own, as `<id>.json`, whole or not at all. An existing one is
 * replaced only with `overwrite`, which the interface sends after it asked; without it the host
 * refuses with its sentence.
 */
export function myTemplateSave(id: string, text: string, overwrite: boolean): Promise<WrittenFile> {
  return invoke<WrittenFile>('my_template_save', { id, text, overwrite });
}

/** Delete the file `<id>.json` from the person's templates folder, and nothing else. */
export async function myTemplateRemove(id: string): Promise<void> {
  await invoke<unknown>('my_template_remove', { id });
}

/** The folder the person's templates are kept in, as a full path (the host creates it). */
export function myTemplatesFolder(): Promise<string> {
  return invoke<string>('my_templates_folder');
}

// ── Decisions (F3) ───────────────────────────────────────────────────────────

/** What may change on a decision. Its deadline is not here: it is computed, never stored. */
export interface DecisionPatch {
  name?: string;
  /** Working days between deciding and having, 0 to 3650. */
  leadTimeDays?: number;
}

export function decisionAdd(
  stageId: string,
  name: string,
  leadTimeDays: number,
): Promise<WorkSnapshot> {
  return invoke<WorkSnapshot>('decision_add', {
    stage_id: stageId,
    name,
    lead_time_days: leadTimeDays,
  });
}

export function decisionUpdate(id: string, patch: DecisionPatch): Promise<WorkSnapshot> {
  return invoke<WorkSnapshot>('decision_update', { id, patch });
}

export function decisionRemove(id: string): Promise<WorkSnapshot> {
  return invoke<WorkSnapshot>('decision_remove', { id });
}

/** Within its stage. */
export function decisionMove(id: string, direction: Direction): Promise<WorkSnapshot> {
  return invoke<WorkSnapshot>('decision_move', { id, direction });
}

/** Mark it made now, with what was decided — or `null` when nothing needs writing down. */
export function decisionMake(id: string, answer: string | null): Promise<WorkSnapshot> {
  return invoke<WorkSnapshot>('decision_make', { id, answer });
}

/** Undo the making: the date and the answer both go, because the answer belongs to the making. */
export function decisionReopen(id: string): Promise<WorkSnapshot> {
  return invoke<WorkSnapshot>('decision_reopen', { id });
}

// ── The diary (F4) ───────────────────────────────────────────────────────────
//
// The diary is not in the work snapshot: at 3 000 entries and 10 000 photos it would make every
// plan edit carry the whole record back. It is read on its own, newest first. There is no command
// that edits or removes an entry, and there never will be: a correction is a new entry.

export type { EntryDraft };

/** What `diary_verify` finds after recomputing every hash and every link. */
export type ChainReport =
  | { entries: number; intact: true }
  | {
      entries: number;
      intact: false;
      brokenAt: number;
      /** What broke, as a word this build translates; `reason` is the host's English sentence. */
      problem: 'contents' | 'link' | 'missing';
      reason: string;
    };

export function diaryEntryAdd(draft: EntryDraft): Promise<DiaryEntry> {
  return invoke<DiaryEntry>('diary_entry_add', { draft });
}

export function diaryList(range?: { fromDay?: string; toDay?: string }): Promise<DiaryEntry[]> {
  return invoke<DiaryEntry[]>('diary_list', range === undefined ? {} : { range });
}

export function diaryVerify(): Promise<ChainReport> {
  return invoke<ChainReport>('diary_verify');
}

/** A photo's thumbnail as a `data:image/jpeg;base64,…` URL — no file path ever reaches the page. */
export function photoThumbnail(hash: string): Promise<string> {
  return invoke<string>('photo_thumbnail', { hash });
}

/** Open the original with the operating system's own handler — from the host, on a press. */
export async function photoOpen(hash: string): Promise<void> {
  await invoke<null>('photo_open', { hash });
}

// ── Checks and the stage's gates (F5) ────────────────────────────────────────

export type { Answer, Gate };

export function checkAdd(stageId: string, gate: Gate, name: string): Promise<WorkSnapshot> {
  return invoke<WorkSnapshot>('check_add', { stage_id: stageId, gate, name });
}

export function checkRename(id: string, name: string): Promise<WorkSnapshot> {
  return invoke<WorkSnapshot>('check_rename', { id, name });
}

/** Within its stage and gate. */
export function checkMove(id: string, direction: Direction): Promise<WorkSnapshot> {
  return invoke<WorkSnapshot>('check_move', { id, direction });
}

/** Refused while the check has an answer: its answers are facts. */
export function checkRemove(id: string): Promise<WorkSnapshot> {
  return invoke<WorkSnapshot>('check_remove', { id });
}

/**
 * The usual checks, already in the person's language (the domain names them by key; the interface
 * resolves the keys). A name the gate already has is skipped by the host. Those named in
 * `needsPhoto` (D3: hidden work) are added needing their photo.
 */
export function checksAddDefaults(
  stageId: string,
  start: readonly string[],
  close: readonly string[],
  needsPhoto: readonly string[] = [],
): Promise<WorkSnapshot> {
  return invoke<WorkSnapshot>('checks_add_defaults', {
    stage_id: stageId,
    start,
    close,
    needs_photo: needsPhoto,
  });
}

/**
 * Answer a check — appended, never replacing: the latest answer counts and every earlier one stays.
 * Not applicable always carries its reason. A photo is either a file the person chose (copied in by
 * the host under the diary's caps) or one the work already holds, by hash.
 */
export function checkAnswer(
  checkId: string,
  answer: Answer,
  reason: string | null,
  photoPath: string | null,
  photoHash: string | null,
): Promise<WorkSnapshot> {
  return invoke<WorkSnapshot>('check_answer', {
    check_id: checkId,
    answer,
    reason,
    photo_path: photoPath,
    photo_hash: photoHash,
  });
}

/**
 * Whether a check needs a photo of the work before it is closed (D3, decision 2): a "yes" on such a
 * check without a photo is refused by the host; "no" and "not applicable" with a reason are not.
 * Refused on a closed stage, like every other change to it.
 */
export function checkSetNeedsPhoto(id: string, needsPhoto: boolean): Promise<WorkSnapshot> {
  return invoke<WorkSnapshot>('check_needs_photo', { id, needs_photo: needsPhoto });
}

/** Start the stage: refused with `stage_gate_open` while the start gate holds. Cannot be undone. */
export function stageStart(id: string): Promise<WorkSnapshot> {
  return invoke<WorkSnapshot>('stage_start', { id });
}

/** Close the stage: refused while the close gate holds, and before it has started. */
export function stageClose(id: string): Promise<WorkSnapshot> {
  return invoke<WorkSnapshot>('stage_close', { id });
}

/** Reopen a closed stage, so it can be changed again. */
export function stageReopen(id: string): Promise<WorkSnapshot> {
  return invoke<WorkSnapshot>('stage_reopen', { id });
}

// ── Money (F6) ───────────────────────────────────────────────────────────────
//
// Every amount crosses this line in whole cents of the work's currency — never a float. The ledger
// is append-only: there is no command that edits or removes a payment; a mistake is a reversal,
// which is a new payment that says so.

/** `amountCents: null` is a line not priced yet — a label, as a template's lines arrive (F9). */
export function costLineAdd(
  stageId: string,
  activityId: string | null,
  label: string,
  amountCents: number | null,
): Promise<WorkSnapshot> {
  return invoke<WorkSnapshot>('cost_line_add', {
    stage_id: stageId,
    activity_id: activityId,
    label,
    amount_cents: amountCents,
  });
}

export interface CostLinePatch {
  label?: string;
  /** `null` takes the price away: the line is not priced yet. */
  amountCents?: number | null;
}

export function costLineUpdate(id: string, patch: CostLinePatch): Promise<WorkSnapshot> {
  return invoke<WorkSnapshot>('cost_line_update', { id, patch });
}

export function costLineRemove(id: string): Promise<WorkSnapshot> {
  return invoke<WorkSnapshot>('cost_line_remove', { id });
}

export interface CommitmentDraft {
  stageId: string;
  personId: string | null;
  label: string;
  amountCents: number;
  /** `YYYY-MM-DD`: the day the quote or contract was accepted. */
  agreedOn: string;
}

export function commitmentAdd(draft: CommitmentDraft): Promise<WorkSnapshot> {
  return invoke<WorkSnapshot>('commitment_add', {
    stage_id: draft.stageId,
    person_id: draft.personId,
    label: draft.label,
    amount_cents: draft.amountCents,
    agreed_on: draft.agreedOn,
    document_path: null,
    document_hash: null,
  });
}

export interface CommitmentPatch {
  label?: string;
  amountCents?: number;
  personId?: string | null;
  agreedOn?: string;
}

/** Refused once a payment names the commitment: what was paid against it stays true. */
export function commitmentUpdate(id: string, patch: CommitmentPatch): Promise<WorkSnapshot> {
  return invoke<WorkSnapshot>('commitment_update', { id, patch });
}

export function commitmentRemove(id: string): Promise<WorkSnapshot> {
  return invoke<WorkSnapshot>('commitment_remove', { id });
}

/** A payment as the ledger will record it. */
export interface PaymentDraftWire {
  day: string;
  stageId: string;
  personId: string | null;
  commitmentId: string | null;
  amountCents: number;
  whatFor: string;
  /** A receipt image the person chose, copied in by the host under the diary's caps. */
  receiptPath: string | null;
  receiptHash: string | null;
}

export function paymentAdd(draft: PaymentDraftWire): Promise<WorkSnapshot> {
  return invoke<WorkSnapshot>('payment_add', { draft });
}

/** Reverse a payment: a new, negative payment naming it, with the reason. Once per payment. */
export function paymentReverse(seq: number, note: string): Promise<WorkSnapshot> {
  return invoke<WorkSnapshot>('payment_reverse', { seq, note });
}

// ── A commitment's payment plan (D2) ─────────────────────────────────────────
//
// A milestone is a share of a commitment's amount, in basis points (30 % = 3000), earned by a fact
// of the work — never a date. Every one of these is refused once a payment names the commitment:
// a plan rewritten after paying would hide being ahead of the work (ADR-037).

export interface MilestoneDraft {
  commitmentId: string;
  label: string;
  /** 1..10 000; the shares of a commitment add up to at most 10 000. */
  shareBp: number;
  trigger: MilestoneTrigger;
  /** Required for `activity_finished` — an activity of the commitment's stage — and `null` otherwise. */
  activityId: string | null;
}

export function milestoneAdd(draft: MilestoneDraft): Promise<WorkSnapshot> {
  return invoke<WorkSnapshot>('milestone_add', {
    commitment_id: draft.commitmentId,
    label: draft.label,
    share_bp: draft.shareBp,
    trigger: draft.trigger,
    activity_id: draft.activityId,
  });
}

export interface MilestonePatch {
  label?: string;
  shareBp?: number;
  trigger?: MilestoneTrigger;
  activityId?: string | null;
}

export function milestoneUpdate(id: string, patch: MilestonePatch): Promise<WorkSnapshot> {
  return invoke<WorkSnapshot>('milestone_update', { id, patch });
}

export function milestoneMove(id: string, direction: Direction): Promise<WorkSnapshot> {
  return invoke<WorkSnapshot>('milestone_move', { id, direction });
}

export function milestoneRemove(id: string): Promise<WorkSnapshot> {
  return invoke<WorkSnapshot>('milestone_remove', { id });
}

/** The labels of the usual three, in the person's language: the host writes them as given. */
export interface UsualMilestoneLabels {
  started: string;
  finished: string;
  closed: string;
}

/**
 * The usual split — 30 % when the stage starts, 40 % when its last activity is finished, 30 % when
 * it closes — on a commitment with no milestones. The host picks the stage's last activity.
 */
export function milestonesUsual(
  commitmentId: string,
  labels: UsualMilestoneLabels,
): Promise<WorkSnapshot> {
  return invoke<WorkSnapshot>('milestones_usual', { commitment_id: commitmentId, labels });
}

// ── Care notes (D3) ──────────────────────────────────────────────────────────
//
// A care note is a sentence the owner keeps about looking after the work, on the work, a room or a
// stage. Editable at any time — it is not the plan, and approval does not lock it — and removed by
// the host with the room or stage it names.

/** What a care note is written on: `work` (its id is the work's), a room, or a stage. */
export interface CareNoteTarget {
  targetKind: CareTargetKind;
  targetId: string;
}

export function careNoteAdd(target: CareNoteTarget, text: string): Promise<WorkSnapshot> {
  return invoke<WorkSnapshot>('care_note_add', {
    target_kind: target.targetKind,
    target_id: target.targetId,
    text,
  });
}

export function careNoteUpdate(id: string, text: string): Promise<WorkSnapshot> {
  return invoke<WorkSnapshot>('care_note_update', { id, text });
}

export function careNoteRemove(id: string): Promise<WorkSnapshot> {
  return invoke<WorkSnapshot>('care_note_remove', { id });
}

/** Within its target. */
export function careNoteMove(id: string, direction: Direction): Promise<WorkSnapshot> {
  return invoke<WorkSnapshot>('care_note_move', { id, direction });
}

// ── Change orders (E1) ───────────────────────────────────────────────────────
//
// A change order is raised on the record and decided once: approved, declined or withdrawn. Both
// tables are insert-only (ADR-041): there is no command that edits or removes either, and there
// never will be — a mistake is withdrawn and raised again. The impact a decision carries is the
// schedule's, computed by the domain at the moment of deciding and sent as that day's fact; the
// host never computes a schedule.

/** A change as it is raised. */
export interface ChangeOrderDraft {
  /** `YYYY-MM-DD`: the day it is raised. */
  raisedOn: string;
  title: string;
  description: string | null;
  askedBy: ChangeAskedBy;
  /** Set exactly when `askedBy` is `person`. */
  askedByPersonId: string | null;
  /** Set exactly when `askedBy` is `other`. */
  askedByName: string | null;
  stageId: string;
  /** Signed: a change can save money; `null` when it is not priced. */
  costCents: number | null;
  effects: readonly ChangeEffect[];
}

export function changeOrderRaise(draft: ChangeOrderDraft): Promise<WorkSnapshot> {
  return invoke<WorkSnapshot>('change_order_raise', { draft });
}

/**
 * The one decision on a change. `finishBefore`, `finishAfter` and `daysDelta` are the impact the
 * domain computed as the person decided; an approval applies the effects inside the open replanning
 * (or opens one naming the change) and adds its money as a cost line, in one transaction.
 */
export interface ChangeOrderDecisionDraft {
  id: string;
  outcome: ChangeOrderOutcome;
  /** `YYYY-MM-DD`. */
  decidedOn: string;
  note: string | null;
  finishBefore: string | null;
  finishAfter: string | null;
  daysDelta: number | null;
}

export function changeOrderDecide(decision: ChangeOrderDecisionDraft): Promise<WorkSnapshot> {
  return invoke<WorkSnapshot>('change_order_decide', { decision });
}

// ── Funding and money received (E2) ──────────────────────────────────────────
//
// Funding is plan: money the work expects, from where and on what day — editable, and removable only
// while no receipt names it. Receipts are facts: the ledger of money received is append-only exactly
// as the payments ledger is — a mistake is a reversal, a new negative receipt that names it, once.

/** Money the work expects to receive, as it is written. */
export interface FundingDraft {
  label: string;
  /** Where it comes from; `null` when not said. */
  source: string | null;
  /** Whole cents, above zero. */
  amountCents: number;
  /** `YYYY-MM-DD`: the day it is expected. */
  expectedOn: string;
  note: string | null;
}

export function fundingAdd(draft: FundingDraft): Promise<WorkSnapshot> {
  return invoke<WorkSnapshot>('funding_add', { draft });
}

/** The row named by `id`, rewritten whole. */
export function fundingUpdate(draft: FundingDraft & { id: string }): Promise<WorkSnapshot> {
  return invoke<WorkSnapshot>('funding_update', { draft });
}

/** Refused once a receipt names the row: money received against it stays true. */
export function fundingRemove(id: string): Promise<WorkSnapshot> {
  return invoke<WorkSnapshot>('funding_remove', { id });
}

/** Money received, as the ledger will record it. */
export interface FundingReceiptDraft {
  /** The funding row it was expected as; `null` for money that arrived unplanned. */
  fundingId: string | null;
  /** Whole cents, above zero. */
  amountCents: number;
  /** `YYYY-MM-DD`, never after today. */
  day: string;
  note: string | null;
}

export function fundingReceiptAdd(draft: FundingReceiptDraft): Promise<WorkSnapshot> {
  return invoke<WorkSnapshot>('funding_receipt_add', { draft });
}

/** Reverse a receipt on `day`: a new, negative receipt naming it. Once per receipt. */
export function fundingReceiptReverse(seq: number, day: string): Promise<WorkSnapshot> {
  return invoke<WorkSnapshot>('funding_receipt_reverse', { seq, day });
}

// ── Snags (E4) ───────────────────────────────────────────────────────────────
//
// A snag is something found wrong or unfinished near the end, raised on the record and closed once:
// fixed, with a photo of it fixed, or withdrawn, with a reason. Both tables are insert-only: there is
// no command that edits or removes either — a snag raised by mistake is withdrawn. A photo is named by
// the hash of a document of the work: the interface adds the file through `documentAdd` first.

/** A snag as it is raised. */
export interface SnagDraft {
  /** `YYYY-MM-DD`: the day it is raised. */
  raisedOn: string;
  title: string;
  description: string | null;
  /** Where it is: a stage of the plan, closed or not. */
  stageId: string;
  /** One of the stage's activities; `null` when it is the stage as a whole. */
  activityId: string | null;
  /** Who must fix it: a person of the plan; `null` when nobody is named. */
  personId: string | null;
  /** `YYYY-MM-DD`, never before `raisedOn`; `null` when no day is said. */
  dueOn: string | null;
  /** The photo of the problem, by the hash of a document of the work; `null` when none. */
  photoHash: string | null;
}

export function snagRaise(draft: SnagDraft): Promise<WorkSnapshot> {
  return invoke<WorkSnapshot>('snag_raise', { draft });
}

/** The one closure of a snag: `fixed` needs its photo, `withdrawn` its reason in `note`. */
export interface SnagClosureDraft {
  snagId: string;
  outcome: SnagOutcome;
  /** `YYYY-MM-DD`, never before the snag was raised. */
  closedOn: string;
  photoHash: string | null;
  note: string | null;
}

export function snagClose(closure: SnagClosureDraft): Promise<WorkSnapshot> {
  return invoke<WorkSnapshot>('snag_close', { closure });
}

// ── Purchases (G2) ───────────────────────────────────────────────────────────
//
// A purchase is plan: something an activity needs that takes time to arrive, with how long the
// supplier takes in calendar days — edited freely, not locked by the plan's approval, and removable
// only while nothing has happened to it. What happened to it — ordered, delivered, the order fell
// through — is a fact: the events are append-only, and there is no command that edits or removes
// one. The day to order by is the domain's, computed every time; nothing here carries it.

/** A purchase as it is written: added, or rewritten whole (`null` clears a field). */
export interface PurchaseDraft {
  /** The stage it is for. */
  stageId: string;
  /** An activity of that stage; `null` for the stage's first activity. */
  activityId: string | null;
  name: string;
  /** How much, in the person's words ("12 m²"); `null` when not said. */
  quantity: string | null;
  /** From whom; `null` when not said. */
  supplier: string | null;
  /** How long the supplier takes, whole calendar days, 0 to 365. */
  leadDays: number;
  note: string | null;
}

export function purchaseAdd(draft: PurchaseDraft): Promise<WorkSnapshot> {
  return invoke<WorkSnapshot>('purchase_add', { draft });
}

/** The purchase named by `id`, rewritten whole. */
export function purchaseUpdate(draft: PurchaseDraft & { id: string }): Promise<WorkSnapshot> {
  return invoke<WorkSnapshot>('purchase_update', { draft });
}

/** Refused once anything has happened to it: an order recorded stays true. */
export function purchaseRemove(id: string): Promise<WorkSnapshot> {
  return invoke<WorkSnapshot>('purchase_remove', { id });
}

/** What happened to a purchase, as the record will keep it. */
export interface PurchaseEventDraft {
  purchaseId: string;
  kind: PurchaseEventKind;
  /** `YYYY-MM-DD`, never after today, nor before the event it follows. */
  day: string;
  note: string | null;
}

export function purchaseEventAdd(event: PurchaseEventDraft): Promise<WorkSnapshot> {
  return invoke<WorkSnapshot>('purchase_event_add', { event });
}

// ── After the handover: warranties and maintenance (G4) ──────────────────────
//
// A warranty is what its paper says, typed by the person: editable and removable, a correction is
// an edit. A maintenance task is what the work needs every so many calendar months: editable, and
// removable only while nothing is recorded done. Each time a task was done is a fact: appended, and
// there is no command that edits or removes one. When a warranty ends and when a task is next due
// are the domain's (`aftercare.ts`), computed every time; nothing here carries them. The calendar
// file is the domain's text, written whole by the host through its one write path.

/** A warranty as it is written: added, or rewritten whole (`null` clears a field). */
export interface WarrantyDraftWire {
  targetKind: CareTargetKind;
  /** The room's or the stage's id; for the work, its `workId`. */
  targetId: string;
  title: string;
  givenBy: string | null;
  /** `YYYY-MM-DD`. */
  startsOn: string;
  /** Whole calendar months, 1 to 600. */
  months: number;
  /** A document filed as a `warranty`; `null` for none. */
  documentId: string | null;
  note: string | null;
}

/** A maintenance task as it is written: added, or rewritten whole. */
export interface MaintenanceDraftWire {
  targetKind: CareTargetKind;
  targetId: string;
  title: string;
  /** Whole calendar months, 1 to 120. */
  everyMonths: number;
  /** `YYYY-MM-DD`: the day it is first due, while nothing is recorded done. */
  firstDueOn: string;
  note: string | null;
}

/** One time a task was done, as the record will keep it. */
export interface MaintenanceDoneWire {
  taskId: string;
  /** `YYYY-MM-DD`, never after today, nor before the time it follows. */
  doneOn: string;
  note: string | null;
}

export function warrantyAdd(draft: WarrantyDraftWire): Promise<WorkSnapshot> {
  return invoke<WorkSnapshot>('warranty_add', { draft });
}

/** The warranty named by `id`, rewritten whole. */
export function warrantyUpdate(draft: WarrantyDraftWire & { id: string }): Promise<WorkSnapshot> {
  return invoke<WorkSnapshot>('warranty_update', { draft });
}

export function warrantyRemove(id: string): Promise<WorkSnapshot> {
  return invoke<WorkSnapshot>('warranty_remove', { id });
}

/** Within its target. */
export function warrantyMove(id: string, direction: Direction): Promise<WorkSnapshot> {
  return invoke<WorkSnapshot>('warranty_move', { id, direction });
}

export function maintenanceAdd(draft: MaintenanceDraftWire): Promise<WorkSnapshot> {
  return invoke<WorkSnapshot>('maintenance_add', { draft });
}

/** The task named by `id`, rewritten whole — its interval too, done or not. */
export function maintenanceUpdate(
  draft: MaintenanceDraftWire & { id: string },
): Promise<WorkSnapshot> {
  return invoke<WorkSnapshot>('maintenance_update', { draft });
}

/** Refused once it has been done: a task with a history stays. */
export function maintenanceRemove(id: string): Promise<WorkSnapshot> {
  return invoke<WorkSnapshot>('maintenance_remove', { id });
}

/** Within its target. */
export function maintenanceMove(id: string, direction: Direction): Promise<WorkSnapshot> {
  return invoke<WorkSnapshot>('maintenance_move', { id, direction });
}

export function maintenanceDoneAdd(record: MaintenanceDoneWire): Promise<WorkSnapshot> {
  return invoke<WorkSnapshot>('maintenance_done_add', { record });
}

/**
 * The calendar of what comes due, as the domain composed it (an RFC 5545 `.ics`), written whole by
 * the host: a full path, `.ics` only, at most 1 MiB; an existing file replaced only with
 * `overwrite`, which the interface sends for a path the save dialog chose. No work needs to be open.
 */
export function aftercareIcsWrite(
  path: string,
  text: string,
  overwrite: boolean,
): Promise<WrittenFile> {
  return invoke<WrittenFile>('aftercare_ics_write', { path, text, overwrite });
}

// ── The weekly site meeting (G1) ─────────────────────────────────────────────
//
// A meeting is written once, at its close: who was there, each agenda item with what was said and
// what was done, the actions it raised and the carried actions it closed — in one transaction, all
// or nothing. Every table is insert-only: there is no command that edits or removes minutes, and
// there never will be — a mistake is said in the next meeting's minutes. What was done in the meeting
// through the product's own commands (a decision made, a change approved) went to the record at the
// moment it was done; the minutes only say that it happened there.

/** Who was at the meeting: a person of the plan, or somebody named — exactly one of the two. */
export interface MinutesAttendeeDraft {
  personId: string | null;
  name: string | null;
}

/** One item of the minutes: the agenda's words, frozen, with what was said and done. */
export interface MinutesItemDraft {
  kind: MeetingItemKind;
  /** The decision, change, snag or action it is about; `null` when about none. */
  refId: string | null;
  title: string;
  note: string | null;
  outcome: string | null;
}

/** An action raised at the meeting: what, who (a person of the plan, a name, or nobody), by when. */
export interface MinutesActionDraft {
  text: string;
  personId: string | null;
  name: string | null;
  /** `YYYY-MM-DD`, or `null` when no day was said. */
  dueOn: string | null;
}

/** A carried action closed at the meeting. */
export interface MinutesClosureDraft {
  actionId: string;
  outcome: MeetingActionOutcome;
  note: string | null;
}

/** The whole of a meeting's minutes, as they are written at its close. */
export interface MinutesDraft {
  /** `YYYY-MM-DD`, never after today. */
  heldOn: string;
  notes: string | null;
  attendees: readonly MinutesAttendeeDraft[];
  items: readonly MinutesItemDraft[];
  actions: readonly MinutesActionDraft[];
  closures: readonly MinutesClosureDraft[];
}

export function meetingClose(minutes: MinutesDraft): Promise<WorkSnapshot> {
  return invoke<WorkSnapshot>('meeting_close', { minutes });
}

/** An action closed between meetings: its one closure. */
export interface ActionClosureDraft {
  actionId: string;
  /** `YYYY-MM-DD`, never after today. */
  closedOn: string;
  outcome: MeetingActionOutcome;
  note: string | null;
}

export function meetingActionClose(closure: ActionClosureDraft): Promise<WorkSnapshot> {
  return invoke<WorkSnapshot>('meeting_action_close', { closure });
}

// ── People as contacts, documents and the folder (F7) ────────────────────────

/** The stages a person is expected on — replaced whole. */
export function personSetStages(id: string, stageIds: readonly string[]): Promise<WorkSnapshot> {
  return invoke<WorkSnapshot>('person_set_stages', { id, stage_ids: stageIds });
}

/** The domain's own kinds (D3 added a warranty and a manual), so the two can never drift. */
export type { DocumentKind, TargetKind };

/** What a document is attached to. */
export interface DocumentTarget {
  targetKind: TargetKind;
  targetId: string;
}

/** A file the host would not keep, and why — in the host's words, naming the file. */
export interface RefusedFile {
  fileName: string;
  reason: string;
}

/**
 * Copy files into the work, each on its own: a batch with one file the product does not keep keeps
 * the others and names the one. A file whose bytes the work already holds is linked, not copied
 * twice. `target` attaches every kept file there; `null` attaches them to the work.
 */
export function documentAdd(
  paths: readonly string[],
  kind: DocumentKind,
  target: DocumentTarget | null,
): Promise<{ snapshot: WorkSnapshot; refused: RefusedFile[] }> {
  return invoke<{ snapshot: WorkSnapshot; refused: RefusedFile[] }>('document_add', {
    paths,
    kind,
    target,
  });
}

export interface DocumentPatch {
  title?: string;
  kind?: DocumentKind;
}

export function documentUpdate(id: string, patch: DocumentPatch): Promise<WorkSnapshot> {
  return invoke<WorkSnapshot>('document_update', { id, patch });
}

export function documentLink(id: string, target: DocumentTarget): Promise<WorkSnapshot> {
  return invoke<WorkSnapshot>('document_link', { id, target });
}

export function documentUnlink(id: string, target: DocumentTarget): Promise<WorkSnapshot> {
  return invoke<WorkSnapshot>('document_unlink', { id, target });
}

/**
 * Remove a document from the library. The file itself stays while anything else names its bytes —
 * a diary photo, an answer, a receipt — and the host says so.
 */
export function documentRemove(id: string): Promise<WorkSnapshot> {
  return invoke<WorkSnapshot>('document_remove', { id });
}

/** Open the file with the operating system's own handler — on a press, never on its own. */
export async function documentOpen(id: string): Promise<void> {
  await invoke<null>('document_open', { id });
}

/** An image document's thumbnail as a `data:` URL; `null` for a PDF, which is never rendered. */
export function documentThumbnail(id: string): Promise<string | null> {
  return invoke<string | null>('document_thumbnail', { id });
}

/** What re-reading every document's bytes found against the hashes the rows recorded. */
export interface DocumentsReport {
  checked: number;
  mismatched: Array<{ id: string; fileName: string; expected: string; found: string }>;
  missing: Array<{ id: string; fileName: string; fileHash: string }>;
  orphans: string[];
}

export function documentsVerify(): Promise<DocumentsReport> {
  return invoke<DocumentsReport>('documents_verify');
}

/** The work folder, measured: its size, and the files in `documents/` and `thumbnails/`. */
export interface FolderHealth {
  folderBytes: number;
  documentFiles: number;
  thumbnailFiles: number;
}

export function folderHealth(): Promise<FolderHealth> {
  return invoke<FolderHealth>('folder_health');
}

/**
 * A recent work found again where it now is: the host checks that the folder holds the same work
 * (by its id) and only then updates the recent list; another work's folder is refused, naming both.
 */
export async function recentRelocate(workId: string, folder: string): Promise<void> {
  await invoke<unknown>('recent_relocate', { work_id: workId, folder });
}

// ── Reports and exports (F10) ────────────────────────────────────────────────
//
// A report is a document the interface composes from the rows the screen shows, already in words,
// and the host lays out and writes as a PDF in the standard Helvetica faces (ADR-031). Every
// command here writes one file: `.pdf`, `.csv` or `.json` by kind, an absolute path, whole or not
// at all; an existing file is replaced only with `overwrite`, which the interface sends only when
// the save dialog chose that exact path (F9's rule). The diary exports verify the chain first,
// inside the host, and write nothing when it does not hold (ADR-032).

/** One block of a report, in the order it is printed. Every string is already in words. */
export type ReportBlock =
  | { type: 'heading'; level: 1 | 2; text: string }
  | { type: 'paragraph'; text: string; tone?: 'normal' | 'muted' | 'strong' }
  /** A figure with its rows listed under it: a report carries its rows too. */
  | { type: 'figure'; label: string; value: string; rows: string[] }
  | {
      type: 'table';
      /** `width` is the column's fraction of the line; the fractions add up to 1. */
      columns: Array<{ text: string; align: 'left' | 'right'; width: number }>;
      rows: string[][];
    }
  | {
      type: 'gantt';
      /** Day columns, counted from day 0 (the first day drawn). */
      days: number;
      /** One per column heading; an empty string leaves that column unlabelled. */
      dayLabels: string[];
      rows: ReportGanttRow[];
    }
  | { type: 'rule' }
  | { type: 'pageBreak' }
  /**
   * A photo the open work holds (D3), named by the SHA-256 of its file — never a path: the host finds
   * it in the work's own `documents/` and embeds it, its caption printed under it. Two `half` images
   * in a row sit side by side. A hash the work does not hold is refused, not skipped.
   */
  | { type: 'image'; hash: string; caption: string; size: 'full' | 'half' };

/** One bar of a printed Gantt: offsets in day columns from day 0. */
export interface ReportGanttRow {
  label: string;
  start: number;
  length: number;
  critical: boolean;
  baselineStart: number | null;
  baselineLength: number | null;
}

export type ReportKind = 'weekly' | 'diary' | 'schedule' | 'handover' | 'snapshot' | 'minutes';

/** What the host renders: a title for the page footer and the metadata, and the blocks. */
export interface ReportDocument {
  kind: ReportKind;
  title: string;
  subtitle: string;
  pageSize: 'a4' | 'a4-landscape';
  /** The language the words are in — the host's own verification block is written in it. */
  language: 'en' | 'pt-BR';
  blocks: ReportBlock[];
}

/** What the host says it wrote. */
export interface WrittenFile {
  path: string;
  bytes: number;
  /** For a PDF. */
  pages?: number;
}

/** The weekly report or the printed schedule, as a PDF. `createdAt` is the metadata's date. */
export function reportPdfWrite(
  path: string,
  document: ReportDocument,
  overwrite: boolean,
  createdAt: string,
): Promise<WrittenFile> {
  return invoke<WrittenFile>('report_pdf_write', {
    path,
    document,
    overwrite,
    created_at: createdAt,
  });
}

/**
 * The owner's snapshot (D4) as one self-contained HTML file: the same document model, rendered by the
 * host to a page with no script and nothing loaded from anywhere (ADR-039). Photos named by hash are
 * embedded re-encoded; the host verifies the bytes before it writes them. `.html` only; an existing
 * file is replaced only with `overwrite`, as every report is.
 */
export function reportHtmlWrite(
  path: string,
  document: ReportDocument,
  overwrite: boolean,
  createdAt: string,
): Promise<WrittenFile> {
  return invoke<WrittenFile>('report_html_write', {
    path,
    document,
    overwrite,
    created_at: createdAt,
  });
}

/**
 * The diary as a PDF. The host verifies the chain first and prepends its own verification block —
 * the interface cannot claim it; a chain that does not hold writes nothing, and the refusal names
 * the entry that broke.
 */
export function diaryExportPdf(
  path: string,
  document: ReportDocument,
  overwrite: boolean,
  createdAt: string,
): Promise<WrittenFile> {
  return invoke<WrittenFile>('diary_export_pdf', {
    path,
    document,
    overwrite,
    created_at: createdAt,
  });
}

/**
 * The diary as CSV, written by the host from the database itself, chain verified first. `,` for an
 * English spreadsheet, `;` for a Portuguese one. A cell that would start a formula is neutralised.
 */
export function diaryExportCsv(
  path: string,
  separator: ',' | ';',
  overwrite: boolean,
): Promise<WrittenFile> {
  return invoke<WrittenFile>('diary_export_csv', { path, separator, overwrite });
}

/** The whole work as JSON for anybody else's tool: the snapshot and the diary with its hashes. */
export function workExportJson(path: string, overwrite: boolean): Promise<WrittenFile> {
  return invoke<WrittenFile>('work_export_json', { path, overwrite });
}

/** Open a file a report command wrote in this session — that file only — in the system's viewer. */
export async function reportOpen(path: string): Promise<void> {
  await invoke<unknown>('report_open', { path });
}

// ── Backup, restore and the diagnostics summary (F11) ────────────────────────
//
// A backup is one `.ridgebeam` file — a ZIP holding the work's database, its documents and
// thumbnails, and a manifest with every file's size and hash (ADR-033). Writing one follows the
// report commands' rule: an absolute path, whole or not at all, an existing file replaced only with
// `overwrite`, which the interface sends only when the save dialog chose that exact path. Restoring
// one never overwrites anything: it makes a new work folder, and the host treats the file as
// hostile until every entry has been checked against the manifest.

/** What the host says it wrote: the file, its size, and how many files it holds. */
export interface BackupWritten {
  path: string;
  bytes: number;
  files: number;
  /** Files in `documents/` or `thumbnails/` a backup never holds by their names; usually none. */
  leftOut: string[];
}

/** A backup's manifest, read without restoring it — the Restore dialog's preview. */
export interface BackupSummary {
  workId: string;
  workName: string;
  /** UTC, as the manifest records it. */
  createdAt: string;
  /** `Ridgebeam <version>`: the build that wrote it. */
  app: string;
  schemaVersion: number;
  files: number;
  bytes: number;
  /** The backup file's own size. */
  archiveBytes: number;
  /** Where the recent list knows this work now, or `null`: restoring moves that row, never the folder. */
  recentFolder: string | null;
}

/** What restoring found, once the work is open from its new folder. */
export interface RestoreReport {
  workId: string;
  folder: string;
  /** Diary entries read back. */
  entries: number;
  /** The diary's chain verified after the restore. */
  chainOk: boolean;
  /** Documents re-hashed after the restore. */
  documents: number;
  /** Documents whose bytes do not match their row (none, when the backup was whole). */
  mismatched: Array<{ id: string; fileName: string; expected: string; found: string }>;
  /** Documents whose file the backup did not hold. */
  missing: Array<{ id: string; fileName: string; fileHash: string }>;
  /** The folder the recent list knew this work at before, when it knew it somewhere else. */
  movedRecentFrom: string | null;
}

/** When the open work was last backed up, by this machine. */
export interface LastBackup {
  /** `YYYY-MM-DD`. */
  day: string;
}

export function backupWrite(path: string, overwrite: boolean): Promise<BackupWritten> {
  return invoke<BackupWritten>('backup_write', { path, overwrite });
}

export function backupInspect(path: string): Promise<BackupSummary> {
  return invoke<BackupSummary>('backup_inspect', { path });
}

/** Restore into `folder` (empty or new); the restored work is open afterwards, as `work_open`. */
export function backupRestore(path: string, folder: string): Promise<RestoreReport> {
  return invoke<RestoreReport>('backup_restore', { path, folder });
}

/** The day the open work was last backed up here, or `null` when it never was. */
export function backupLast(): Promise<LastBackup | null> {
  return invoke<LastBackup | null>('backup_last');
}

/** Diagnostics as plain text, for a bug report: what the screen shows, paths included. */
export function diagnosticsSummary(): Promise<string> {
  return invoke<string>('diagnostics_summary');
}
