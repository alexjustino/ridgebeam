/**
 * The front door's figures about the site this week (slice F10, SPEC §2.14): this week on site, the
 * people expected, the days weather took, and the last entries of the diary.
 *
 * **A week is Monday to Sunday**, the calendar week the day falls in, the same week the weekly report
 * prints (`reports/weekly.ts` reads every one of these figures from here, so the page and the screen
 * cannot disagree). What happened comes from the diary's **effective** entries — a corrected entry
 * speaks for nothing; its correction speaks for the day — except for the last entries, which are
 * the last written, corrections included, as the diary lists them.
 *
 * **A day is not "without an entry" until it is over**: today, and the days after it, are still to
 * come. A day before the work's start is not missing either. Unlike `daysWithoutEntry` (the whole
 * work, which starts counting at the diary's first entry), a week asked about is asked about whole:
 * a working day of it with nothing written is listed even when the diary had not begun.
 *
 * **Weather days lost** are the days an effective entry says it rained or stormed and no effective
 * entry of that day says anything was done. The diary's own `lostDay` flag is carried on the row
 * (said or not), never required: a rainy day with nothing done is lost whether or not the box was
 * ticked.
 *
 * **People expected** this week are the people who answer for an activity the schedule places in
 * the week, and the people put on a stage that is running (started, not closed).
 *
 * Today is an input. What this module is not: text, storage or the diary's chain. No I/O.
 */

import { stageState } from '../checks';
import {
  addCalendarDays,
  isIsoDay,
  isWorkingDay,
  weekdayIndex,
  type WorkingCalendar,
} from '../calendar';
import {
  correctedBy,
  effectiveEntries,
  WEATHER,
  type DiaryEntry,
  type Photo,
  type Weather,
} from '../diary';
import { counted, type Figure, type ReportRow } from '../figure';
import { compareText, stagesInOrder, type WorkSnapshot } from '../plan';
import type { Schedule } from '../schedule';

// ── The week ─────────────────────────────────────────────────────────────────

/** A calendar week, Monday to Sunday. */
export interface Week {
  /** The Monday. */
  readonly from: string;
  /** The Sunday. */
  readonly to: string;
  /** The seven days, Monday first. */
  readonly days: readonly string[];
}

/** The week `day` falls in, Monday to Sunday; `null` when `day` is not a `YYYY-MM-DD` day. */
export function weekOf(day: string): Week | null {
  if (!isIsoDay(day)) return null;
  const from = addCalendarDays(day, -weekdayIndex(day));
  const days = [0, 1, 2, 3, 4, 5, 6].map((n) => addCalendarDays(from, n));
  return { from, to: days[6]!, days };
}

/** Is `day` inside the week, both ends included? */
function inWeek(week: Week, day: string): boolean {
  return day >= week.from && day <= week.to;
}

/**
 * What a day of the week is, for the diary:
 *
 * - `written`: an effective entry is about it (whatever the calendar says of it);
 * - `missing`: a working day, on or after the work's start, over (before today), with nothing written;
 * - `to-come`: a working day from today on with nothing written yet — today is not over;
 * - `not-working`: a weekend or holiday with nothing written;
 * - `before-start`: before the work's start, with nothing written;
 * - `unknown`: nothing written, and the calendar cannot say whether the site works that day.
 */
export type WeekDayStatus =
  'written' | 'missing' | 'to-come' | 'not-working' | 'before-start' | 'unknown';

export const WEEK_DAY_STATUS_KEYS = {
  written: 'dashboard.weekDay.written',
  missing: 'dashboard.weekDay.missing',
  'to-come': 'dashboard.weekDay.toCome',
  'not-working': 'dashboard.weekDay.notWorking',
  'before-start': 'dashboard.weekDay.beforeStart',
  unknown: 'dashboard.weekDay.unknown',
} as const satisfies Record<WeekDayStatus, string>;

/** One day of a week, as the diary sees it. */
export interface WeekDay {
  readonly day: string;
  /** A working day on the work's calendar; `null` when the calendar cannot be counted on. */
  readonly working: boolean | null;
  readonly holiday: boolean;
  readonly status: WeekDayStatus;
  /** The effective entries about this day, by seq. */
  readonly seqs: readonly number[];
  /** The weather those entries give, each once, in the order `WEATHER` lists them. */
  readonly weather: readonly Weather[];
  /** An effective entry of the day says no work was possible. */
  readonly lostDay: boolean;
}

/** The effective entries of a week, by day then seq. */
function weekEntries(entries: readonly DiaryEntry[], week: Week): DiaryEntry[] {
  return effectiveEntries(entries)
    .filter((entry) => inWeek(week, entry.day))
    .sort((a, b) => compareText(a.day, b.day) || a.seq - b.seq);
}

/** The seven days of a week, Monday first, each with what the diary says of it. */
export function weekDays(
  calendar: WorkingCalendar | null,
  week: Week,
  today: string,
  workStart: string,
  entries: readonly DiaryEntry[],
): WeekDay[] {
  const effective = weekEntries(entries, week);
  return week.days.map((day) => {
    const ofDay = effective.filter((entry) => entry.day === day);
    const working = calendar === null ? null : isWorkingDay(calendar, day);
    let status: WeekDayStatus;
    if (ofDay.length > 0) status = 'written';
    else if (isIsoDay(workStart) && day < workStart) status = 'before-start';
    else if (working === null) status = 'unknown';
    else if (!working) status = 'not-working';
    else if (day >= today) status = 'to-come';
    else status = 'missing';
    const said = new Set(ofDay.map((entry) => entry.weather));
    return {
      day,
      working,
      holiday: calendar?.holidays.has(day) ?? false,
      status,
      seqs: ofDay.map((entry) => entry.seq),
      weather: WEATHER.filter((weather) => said.has(weather)),
      lostDay: ofDay.some((entry) => entry.lostDay),
    };
  });
}

// ── Rows ─────────────────────────────────────────────────────────────────────

/** A row that is one diary entry: what the front door shows of it, photos included. */
export interface EntryRow extends ReportRow {
  readonly seq: number;
  readonly kind: DiaryEntry['kind'];
  readonly correctsSeq: number | null;
  /** The entry that corrected this one, directly; `null` when none did. */
  readonly correctedBySeq: number | null;
  readonly weather: Weather | null;
  readonly lostDay: boolean;
  /** How many activities it says were worked on or finished. */
  readonly doneCount: number;
  /** How many people it says were on site. */
  readonly presentCount: number;
  /** Its photos, for the thumbnails, in the order it holds them. */
  readonly photos: readonly Photo[];
}

function entryRow(entry: DiaryEntry, corrector: number | null): EntryRow {
  return {
    key: `entry:${entry.seq}`,
    itemId: String(entry.seq),
    title: entry.note ?? '',
    day: entry.day,
    minutes: 0,
    seq: entry.seq,
    kind: entry.kind,
    correctsSeq: entry.correctsSeq,
    correctedBySeq: corrector,
    weather: entry.weather,
    lostDay: entry.lostDay,
    doneCount: entry.done.length,
    presentCount: entry.present.length,
    photos: entry.photos,
  };
}

function dayRow(day: string): ReportRow {
  return { key: `day:${day}`, itemId: null, title: day, day, minutes: 0 };
}

/** A row that is a person: on site this week, or expected. */
export interface PersonRow extends ReportRow {
  readonly personId: string;
  /** The person is in the plan; `false` for an id the plan no longer has (shown by its id). */
  readonly known: boolean;
  readonly trade: string | null;
  /** The days of the week the diary says they were on site, oldest first. */
  readonly days: readonly string[];
}

/** A row of the people-expected figure: a person, and why they are expected. */
export interface ExpectedRow extends ReportRow {
  readonly personId: string;
  readonly trade: string | null;
  /** The activities they answer for that the schedule places in the week, in plan order. */
  readonly activityIds: readonly string[];
  /** The running stages they are put on, in plan order. */
  readonly stageIds: readonly string[];
}

/** A row of the weather-lost figure: one day. */
export interface WeatherLostRow extends ReportRow {
  readonly day: string;
  /** The worse of what was said: `storm` when any entry of the day says so, otherwise `rain`. */
  readonly weather: 'rain' | 'storm';
  /** An entry of the day also ticked "no work was possible". */
  readonly lostDay: boolean;
  /** The effective entries about the day, by seq. */
  readonly seqs: readonly number[];
}

// ── Figures ──────────────────────────────────────────────────────────────────

export const DASHBOARD_LABEL_KEYS = {
  weekEntries: 'dashboard.figure.weekEntries',
  weekDaysWithoutEntry: 'dashboard.figure.weekDaysWithoutEntry',
  onSite: 'dashboard.figure.onSite',
  peopleExpected: 'dashboard.figure.peopleExpected',
  weatherLost: 'dashboard.figure.weatherLost',
  lastEntries: 'dashboard.figure.lastEntries',
} as const;

/** The weather that can take a day. */
export const WEATHER_LOST: readonly Weather[] = ['rain', 'storm'];

/**
 * This week on site: the effective entries of the week, by day then seq. An effective entry is the
 * latest of its family, so nothing has corrected it: `correctedBySeq` is always `null` here.
 */
export function weekEntriesFigure(entries: readonly DiaryEntry[], week: Week): Figure<EntryRow> {
  return counted(
    'week-entries',
    DASHBOARD_LABEL_KEYS.weekEntries,
    weekEntries(entries, week).map((entry) => entryRow(entry, null)),
  );
}

/** The working days of the week that are over and have nothing written (`missing`), oldest first. */
export function weekDaysWithoutEntryFigure(days: readonly WeekDay[]): Figure {
  return counted(
    'week-days-without-entry',
    DASHBOARD_LABEL_KEYS.weekDaysWithoutEntry,
    days.filter((day) => day.status === 'missing').map((day) => dayRow(day.day)),
  );
}

/**
 * Who was on site in the week: every person an effective entry of the week names, by name; ids the
 * plan no longer has come last, by id, shown rather than dropped.
 */
export function onSiteFigure(
  snapshot: WorkSnapshot,
  entries: readonly DiaryEntry[],
  week: Week,
): Figure<PersonRow> {
  const days = new Map<string, Set<string>>();
  for (const entry of weekEntries(entries, week)) {
    for (const id of entry.present) {
      const set = days.get(id);
      if (set === undefined) days.set(id, new Set([entry.day]));
      else set.add(entry.day);
    }
  }
  const people = new Map(snapshot.people.map((person) => [person.id, person]));
  const rows: PersonRow[] = [...days.entries()].map(([id, set]) => {
    const person = people.get(id);
    const list = [...set].sort(compareText);
    return {
      key: `person:${id}`,
      itemId: person === undefined ? null : id,
      title: person?.name ?? id,
      day: list.at(-1)!,
      minutes: 0,
      personId: id,
      known: person !== undefined,
      trade: person?.trade ?? null,
      days: list,
    };
  });
  rows.sort(
    (a, b) =>
      Number(!a.known) - Number(!b.known) ||
      compareText(a.title, b.title) ||
      compareText(a.personId, b.personId),
  );
  return counted('on-site', DASHBOARD_LABEL_KEYS.onSite, rows);
}

/**
 * The people expected in the week: whoever answers for an activity the schedule places in it (its
 * first to last day overlapping Monday to Sunday), and whoever is put on a stage that is running.
 * By name, each once, with why.
 */
export function peopleExpectedFigure(
  snapshot: WorkSnapshot,
  scheduled: Schedule,
  week: Week,
): Figure<ExpectedRow> {
  const running = new Set(
    snapshot.stages.filter((stage) => stageState(stage) === 'started').map((stage) => stage.id),
  );
  const stageOrder = new Map(stagesInOrder(snapshot).map((stage, index) => [stage.id, index]));
  const rows: ExpectedRow[] = [];
  for (const person of snapshot.people) {
    const activityIds = scheduled.activities
      .filter((activity) => {
        if (activity.responsibleId !== person.id) return false;
        const dates = scheduled.dates.get(activity.id);
        return dates !== undefined && dates.start <= week.to && dates.finish >= week.from;
      })
      .map((activity) => activity.id);
    const stageIds = [...new Set(person.stageIds.filter((id) => running.has(id)))].sort(
      (a, b) => stageOrder.get(a)! - stageOrder.get(b)!,
    );
    if (activityIds.length === 0 && stageIds.length === 0) continue;
    rows.push({
      key: `person:${person.id}`,
      itemId: person.id,
      title: person.name,
      day: null,
      minutes: 0,
      personId: person.id,
      trade: person.trade,
      activityIds,
      stageIds,
    });
  }
  rows.sort((a, b) => compareText(a.title, b.title) || compareText(a.personId, b.personId));
  return counted('people-expected', DASHBOARD_LABEL_KEYS.peopleExpected, rows);
}

/**
 * The days weather took, oldest first: an effective entry of the day says rain or storm, and none
 * of the day's effective entries says anything was worked on or finished. The whole diary, or only
 * the days of `week` when one is given.
 */
export function weatherLostFigure(
  entries: readonly DiaryEntry[],
  week: Week | null = null,
): Figure<WeatherLostRow> {
  const byDay = new Map<string, DiaryEntry[]>();
  for (const entry of effectiveEntries(entries)) {
    if (week !== null && !inWeek(week, entry.day)) continue;
    const list = byDay.get(entry.day);
    if (list === undefined) byDay.set(entry.day, [entry]);
    else list.push(entry);
  }
  const rows: WeatherLostRow[] = [];
  for (const [day, list] of [...byDay.entries()].sort(([a], [b]) => compareText(a, b))) {
    const bad = list.filter(
      (entry) => entry.weather !== null && WEATHER_LOST.includes(entry.weather),
    );
    if (bad.length === 0 || list.some((entry) => entry.done.length > 0)) continue;
    rows.push({
      key: `day:${day}`,
      itemId: null,
      title: day,
      day,
      minutes: 0,
      weather: bad.some((entry) => entry.weather === 'storm') ? 'storm' : 'rain',
      lostDay: list.some((entry) => entry.lostDay),
      seqs: list.map((entry) => entry.seq),
    });
  }
  return counted('weather-lost', DASHBOARD_LABEL_KEYS.weatherLost, rows);
}

/**
 * The last entries written, newest first (`count`, three by default): what the diary lists last,
 * corrections included, each saying what it corrects or what corrected it.
 */
export function lastEntriesFigure(entries: readonly DiaryEntry[], count = 3): Figure<EntryRow> {
  const corrected = correctedBy(entries);
  const rows = [...entries]
    .sort((a, b) => b.seq - a.seq)
    .slice(0, Math.max(0, count))
    .map((entry) => entryRow(entry, corrected.get(entry.seq) ?? null));
  return counted('last-entries', DASHBOARD_LABEL_KEYS.lastEntries, rows);
}
