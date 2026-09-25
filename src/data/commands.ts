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

import type { Direction } from '@/domain/ordering';
import type { Endpoint, Holiday, WorkSnapshot } from '@/domain/plan';
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
export interface ActivityPatch {
  name?: string;
  durationDays?: number | null;
  responsibleId?: string | null;
  /** Zero or more, finite; `null` clears it — and clears the unit with it. */
  quantity?: number | null;
  /** Up to 16 characters; a unit needs a quantity, and empty is `null`. */
  unit?: string | null;
}

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

/** The files and pragmas Diagnostics shows, read back from the connections. */
export interface Diagnostics {
  app: { databasePath: string; schemaVersion: number };
  work: null | {
    folder: string;
    databasePath: string;
    schemaVersion: number;
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
  durationDays: 3650,
  hoursPerDay: 24,
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

export function workCreate(folder: string, draft: WorkDraft): Promise<WorkSummary> {
  return invoke<WorkSummary>('work_create', { folder, draft });
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

export function personRename(id: string, name: string): Promise<WorkSnapshot> {
  return invoke<WorkSnapshot>('person_rename', { id, name });
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
