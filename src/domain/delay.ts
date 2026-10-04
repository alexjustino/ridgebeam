/**
 * Why is it late, and on whose account? The delay ledger (slice E3).
 *
 * The forecast (`schedule/forecast.ts`) says how many working days the work will finish after the
 * latest baseline as things stand. The ledger puts each of those days down to a cause and, where
 * the record says so, to a party, and says plainly how many days the record does not explain. It
 * attributes; it does not judge. It is not a claim, and not legal evidence: the party is who the
 * record names.
 *
 * **The causes, in priority order**, so nothing is counted twice. A working day of the plan's
 * calendar is put down to one cause at most, the first that takes it:
 *
 * 1. **`change`**: every change order approved after the latest baseline was taken (its decision
 *    recorded after it: an earlier one is already in the baseline), for the working days its
 *    decision froze (`daysDelta`, signed). Party: who asked. Not a day of the diary, so it takes no
 *    day from the others.
 * 2. **`stated`**: a lost day whose entry says why (`lostCause`): that cause, and the person the
 *    entry names, or the owner for a decision or an owner's request.
 * 3. **`weather`**: a day an effective entry says rain or storm, with no cause said, and either
 *    marked lost or with nothing done on it (the dashboard's weather rule, which also takes a rainy
 *    day ticked lost).
 * 4. **`unstated`**: a day marked lost, with no cause said and no rain or storm. Nobody's account:
 *    it says "lost, no cause said", and never guesses weather on a sunny day. Lost days written
 *    before slice E3 have no cause, so they land here or in `weather`.
 *
 *    Rules 2 to 4 count a day only **while an activity of the forecast's critical chain was running
 *    that day, or due to start** (the baseline had it started by then, and it had not): a day lost
 *    while only floating work ran cost the finish nothing.
 * 5. **`decision`**: a decision made after its **baseline** deadline (the baseline's stage start
 *    less its lead time), for the working days from that deadline to the day it was made, **capped**
 *    at the working days its stage started late against the baseline (its actual start, or its
 *    forecast start while it has not started): a late decision that delayed nothing costs nothing.
 *    Party: the owner.
 * 6. **`absence`**: a working day with an entry on which a critical activity that was running had
 *    nothing done and its responsible was not on site. Party: that person. A day with no entry is
 *    not absence: unknown is not absent.
 *
 * Whatever is left is **not explained** (`unexplainedDays`), and is always shown. When the record
 * names more days than the finish lost (float absorbed some, or work since went faster than planned),
 * the difference is never a negative "unexplained": it is its own row, **made up** (`madeUpDays`,
 * a negative number of days in the figures), so the rows still add up to the total exactly.
 *
 * **One row per cause.** A cause the diary stated and the same cause inferred (a stated "weather"
 * and a rainy day with nothing done; a stated "waiting for a decision" and a late decision) share
 * one row of the by-cause figure; its trace rows each say which (`stated`), and the row carries the
 * days of each (`statedDays`, `inferredDays`). The ledger's own lines stay one per rule, cause and
 * party (`entries`). A work that is
 * on time or ahead gets no causes at all: the ledger says so instead of inventing them. Before the
 * plan is approved there is no baseline, and the ledger says it needs one.
 *
 * A day is counted once, whatever the number of activities running: a lost day moves the
 * finish by one day, not one per activity. The rows name the activities. Every figure carries its
 * rows, and every row its trace (the days, the changes), so any number can be opened.
 *
 * Today is an input. What this module is not: storage, or text. No I/O.
 */

import {
  addCalendarDays,
  isIsoDay,
  isWorkingDay,
  subtractWorkingDays,
  workingDaysUntil,
} from './calendar';
import { changeState } from './changes';
import { WEATHER_LOST } from './dashboard';
import { effectiveEntries, type DiaryEntry, type LostCause } from './diary';
import { daysFigure, type DaysRow, type Figure, type ReportRow } from './figure';
import {
  activitiesInOrder,
  compareText,
  decisionsInOrder,
  latestBaseline,
  type Baseline,
  type ChangeOrder,
  type WorkSnapshot,
} from './plan';
import type { Schedule } from './schedule';
import { forecast, type Forecast } from './schedule/forecast';
import { slip, type SlipRow } from './schedule/slip';

// ── Words ────────────────────────────────────────────────────────────────────

/** Which rule put a day down to its cause. Also the priority order. */
export const DELAY_BASES = [
  'change',
  'stated',
  'weather',
  'unstated',
  'decision',
  'absence',
] as const;
export type DelayBasis = (typeof DELAY_BASES)[number];

/** What a day is put down to: a change order, or one of the diary's causes for a lost day. */
export type DelayCause = 'change' | LostCause | 'unstated';

/** The order the causes are listed in. */
export const DELAY_CAUSES = [
  'change',
  'decision',
  'weather',
  'unstated',
  'absence',
  'material',
  'owner',
  'access',
  'other',
] as const satisfies readonly DelayCause[];

/** What is left once every cause has taken its days: not explained, or made up. */
export type DelayResidual = 'unexplained' | 'made-up';

/** Where the work stands against its baseline, as the ledger reads it. */
export type DelayStatus = 'late' | 'on-time' | 'ahead' | 'needs-approval' | 'no-forecast';

export const DELAY_LABEL_KEYS = {
  /** "Why is it late?" */
  title: 'delay.title',
  /** Days late as things stand. */
  total: 'delay.figure.total',
  /** By cause. */
  byCause: 'delay.figure.byCause',
  /** By party. */
  byParty: 'delay.figure.byParty',
} as const;

export const DELAY_STATUS_KEYS = {
  late: 'delay.status.late',
  'on-time': 'delay.status.onTime',
  ahead: 'delay.status.ahead',
  'needs-approval': 'delay.status.needsApproval',
  'no-forecast': 'delay.status.noForecast',
} as const satisfies Record<DelayStatus, string>;

export const DELAY_CAUSE_KEYS = {
  change: 'delay.cause.change',
  decision: 'delay.cause.decision',
  weather: 'delay.cause.weather',
  unstated: 'delay.cause.unstated',
  absence: 'delay.cause.absence',
  material: 'delay.cause.material',
  owner: 'delay.cause.owner',
  access: 'delay.cause.access',
  other: 'delay.cause.other',
  unexplained: 'delay.cause.unexplained',
  'made-up': 'delay.cause.madeUp',
} as const satisfies Record<DelayCause | DelayResidual, string>;

export const DELAY_BASIS_KEYS = {
  change: 'delay.basis.change',
  stated: 'delay.basis.stated',
  weather: 'delay.basis.weather',
  unstated: 'delay.basis.unstated',
  decision: 'delay.basis.decision',
  absence: 'delay.basis.absence',
} as const satisfies Record<DelayBasis, string>;

/** The parties that have no name of their own on the record. */
export const DELAY_PARTY_KEYS = {
  owner: 'delay.party.owner',
  none: 'delay.party.none',
  /** A person the record names who is no longer in the plan. */
  formerPerson: 'delay.party.formerPerson',
} as const;

// ── Parties ──────────────────────────────────────────────────────────────────

/** Who a day is put down to, as the record names them. */
export type DelayParty =
  | { readonly kind: 'owner' }
  /** `name` is `null` for a person no longer in the plan. */
  | { readonly kind: 'person'; readonly personId: string; readonly name: string | null }
  | { readonly kind: 'other'; readonly name: string };

/**
 * A party's key: `owner`, `person:<id>`, `other:<name>`, or `none` for nobody (`null`: weather, a
 * day lost with no cause said, no access, or a cause said without a who).
 */
export function partyKey(party: DelayParty | null): string {
  if (party === null) return 'none';
  switch (party.kind) {
    case 'owner':
      return 'owner';
    case 'person':
      return `person:${party.personId}`;
    case 'other':
      return `other:${party.name}`;
  }
}

// ── Rows ─────────────────────────────────────────────────────────────────────

/** One thing the ledger counted: a working day, or a change order. */
export interface DelayTraceRow extends ReportRow {
  /** Working days it counts for: 1 for a day; the frozen `daysDelta` for a change. */
  readonly days: number;
  readonly basis: DelayBasis;
  readonly cause: DelayCause;
  /** The diary said this cause (`stated`); otherwise the ledger inferred it from the record. */
  readonly stated: boolean;
  /** The critical activities running or due that day (`absence`: the one whose crew was away). */
  readonly activityIds: readonly string[];
  /** The effective diary entries of that day, by seq. */
  readonly seqs: readonly number[];
  readonly changeOrderId: string | null;
  readonly decisionId: string | null;
}

/** One line of the ledger: a rule, a cause and a party, with the days and what they were. */
export interface DelayEntry {
  readonly key: string;
  readonly basis: DelayBasis;
  readonly cause: DelayCause;
  /** `null`: nobody's account. */
  readonly party: DelayParty | null;
  readonly days: number;
  readonly rows: readonly DelayTraceRow[];
}

/** A row of the by-cause figure: one cause, or what is left. */
export interface DelayCauseRow extends DaysRow {
  readonly cause: DelayCause | DelayResidual;
  /** The rules that put days down to it, in priority order. */
  readonly bases: readonly DelayBasis[];
  /** Of `days`, those the diary stated, and those inferred from the record (changes included). */
  readonly statedDays: number;
  readonly inferredDays: number;
  readonly trace: readonly DelayTraceRow[];
}

/**
 * A row of the by-party figure: one party, nobody (`party` `null`, `residual` `null`), or what is
 * left (`residual` set).
 */
export interface DelayPartyRow extends DaysRow {
  readonly party: DelayParty | null;
  readonly residual: DelayResidual | null;
  /** The causes put down to it, in the order causes are listed. */
  readonly causes: readonly DelayCause[];
  readonly trace: readonly DelayTraceRow[];
}

export interface DelayLedger {
  readonly status: DelayStatus;
  /** The forecast it reads. */
  readonly forecast: Forecast;
  /** The baseline it stands against; `null` before approval. */
  readonly baselineNumber: number | null;
  /** Forecast finish against the baseline's, signed working days; `null` when not known. */
  readonly total: number | null;
  /** Every line, in priority order; empty unless the work is late. */
  readonly entries: readonly DelayEntry[];
  /** The days the entries account for. */
  readonly attributed: number;
  /** Days late the record does not explain: `total − attributed`, when positive. */
  readonly unexplainedDays: number;
  /** Days the record names beyond what the finish lost: made up since. */
  readonly madeUpDays: number;
  /** The three figures; `null` when there is nothing to stand against. */
  readonly figures: {
    readonly total: Figure<SlipRow>;
    readonly byCause: Figure<DelayCauseRow>;
    readonly byParty: Figure<DelayPartyRow>;
  } | null;
}

// ── The ledger ───────────────────────────────────────────────────────────────

function changeParty(change: ChangeOrder, names: ReadonlyMap<string, string>): DelayParty {
  if (change.askedBy === 'person') {
    const personId = change.askedByPersonId ?? '';
    return { kind: 'person', personId, name: names.get(personId) ?? null };
  }
  if (change.askedBy === 'other') return { kind: 'other', name: (change.askedByName ?? '').trim() };
  return { kind: 'owner' };
}

function statedParty(entry: DiaryEntry, names: ReadonlyMap<string, string>): DelayParty | null {
  if (entry.lostPartyPersonId !== null) {
    const personId = entry.lostPartyPersonId;
    return { kind: 'person', personId, name: names.get(personId) ?? null };
  }
  return entry.lostCause === 'decision' || entry.lostCause === 'owner' ? { kind: 'owner' } : null;
}

/**
 * The first day each stage starts in a set of dates, from rows that name their activity: the
 * current activity's stage, or, for an activity since removed, the baseline stage of the same name.
 */
function baselineStageStarts(snapshot: WorkSnapshot, baseline: Baseline): Map<string, string> {
  const stageOfActivity = new Map(snapshot.activities.map((each) => [each.id, each.stageId]));
  const stageByName = new Map(baseline.stages.map((each) => [each.name, each.stageId]));
  const starts = new Map<string, string>();
  for (const row of baseline.rows) {
    if (row.start === null) continue;
    const stageId = stageOfActivity.get(row.activityId) ?? stageByName.get(row.stageName);
    if (stageId === undefined) continue;
    const known = starts.get(stageId);
    if (known === undefined || row.start < known) starts.set(stageId, row.start);
  }
  return starts;
}

/**
 * The delay ledger of a work as things stand on `today`, from its plan, its schedule (`schedule()`
 * of the same snapshot) and every diary entry. Never throws.
 */
export function delayLedger(
  snapshot: WorkSnapshot,
  scheduled: Schedule,
  entries: readonly DiaryEntry[],
  today: string,
): DelayLedger {
  const ahead = forecast(snapshot, scheduled, entries, today);
  const baseline = latestBaseline(snapshot);
  const nothing = (status: DelayStatus): DelayLedger => ({
    status,
    forecast: ahead,
    baselineNumber: baseline?.number ?? null,
    total: null,
    entries: [],
    attributed: 0,
    unexplainedDays: 0,
    madeUpDays: 0,
    figures: null,
  });
  if (baseline === null) return nothing('needs-approval');
  const calendar = scheduled.calendar;
  const total = ahead.daysAgainstBaseline;
  if (ahead.problem !== null || calendar === null || total === null) return nothing('no-forecast');

  const totalFigure: Figure<SlipRow> = {
    ...slip({ ...scheduled, dates: ahead.dates, finishDate: ahead.finishDate }, baseline),
    id: 'delay:total',
    label: DELAY_LABEL_KEYS.total,
  };
  if (total <= 0) {
    return {
      ...nothing(total < 0 ? 'ahead' : 'on-time'),
      total,
      figures: {
        total: totalFigure,
        byCause: daysFigure('delay:by-cause', DELAY_LABEL_KEYS.byCause, 0, []),
        byParty: daysFigure('delay:by-party', DELAY_LABEL_KEYS.byParty, 0, []),
      },
    };
  }

  const names = new Map(snapshot.people.map((person) => [person.id, person.name]));
  const lines = new Map<string, DelayEntry>();
  const add = (
    basis: DelayBasis,
    cause: DelayCause,
    party: DelayParty | null,
    row: DelayTraceRow,
  ) => {
    const key = `${basis}|${cause}|${partyKey(party)}`;
    const line = lines.get(key);
    lines.set(key, {
      key,
      basis,
      cause,
      party,
      days: (line?.days ?? 0) + row.days,
      rows: [...(line?.rows ?? []), row],
    });
  };
  const trace = (
    key: string,
    parts: Pick<DelayTraceRow, 'itemId' | 'title' | 'day' | 'days' | 'basis' | 'cause'> &
      Partial<DelayTraceRow>,
  ): DelayTraceRow => ({
    key,
    minutes: 0,
    stated: parts.basis === 'stated',
    activityIds: [],
    seqs: [],
    changeOrderId: null,
    decisionId: null,
    ...parts,
  });

  // 1. Change orders approved after the baseline was taken.
  const changes = [...snapshot.changeOrders].sort(
    (a, b) => a.number - b.number || compareText(a.id, b.id),
  );
  for (const change of changes) {
    const decision = change.decision;
    if (changeState(change) !== 'approved' || decision === null) continue;
    if (decision.createdAt <= baseline.takenAt) continue;
    if (decision.daysDelta === null || decision.daysDelta === 0) continue;
    add(
      'change',
      'change',
      changeParty(change, names),
      trace(`change:${change.id}`, {
        itemId: change.id,
        title: change.title,
        day: decision.decidedOn,
        days: decision.daysDelta,
        basis: 'change',
        cause: 'change',
        changeOrderId: change.id,
      }),
    );
  }

  // The diary, by working day: only the effective entries speak.
  const byDay = new Map<string, DiaryEntry[]>();
  for (const entry of effectiveEntries(entries)) {
    if (!isIsoDay(entry.day) || entry.day > today || !isWorkingDay(calendar, entry.day)) continue;
    const list = byDay.get(entry.day);
    if (list === undefined) byDay.set(entry.day, [entry]);
    else list.push(entry);
  }
  const days = [...byDay.keys()].sort(compareText);
  const claimed = new Set<string>();

  const activities = activitiesInOrder(snapshot);
  const plannedStart = new Map<string, string>();
  for (const activity of activities) {
    const start = scheduled.dates.get(activity.id)?.start;
    if (start !== undefined) plannedStart.set(activity.id, start);
  }
  for (const row of baseline.rows) {
    if (row.start !== null) plannedStart.set(row.activityId, row.start);
    else plannedStart.delete(row.activityId);
  }
  const critical = activities.filter((activity) => ahead.critical.has(activity.id));
  const running = (id: string, day: string): boolean => {
    const dates = ahead.dates.get(id)!;
    return dates.start <= day && day <= dates.finish;
  };
  /** The critical activities running on `day`, or due to start by it and not yet started. */
  const onChain = (day: string): string[] =>
    critical
      .filter((activity) => {
        if (running(activity.id, day)) return true;
        const planned = plannedStart.get(activity.id);
        return planned !== undefined && planned <= day && day < ahead.dates.get(activity.id)!.start;
      })
      .map((activity) => activity.id);

  // 2. A lost day whose entry says why.
  for (const day of days) {
    const list = byDay.get(day)!;
    const said = list.find((entry) => entry.lostDay && entry.lostCause !== null);
    if (said === undefined) continue;
    const chain = onChain(day);
    if (chain.length === 0) continue;
    claimed.add(day);
    add(
      'stated',
      said.lostCause!,
      statedParty(said, names),
      trace(`day:${day}`, {
        itemId: String(said.seq),
        title: day,
        day,
        days: 1,
        basis: 'stated',
        cause: said.lostCause!,
        activityIds: chain,
        seqs: list.map((entry) => entry.seq),
      }),
    );
  }

  // 3 and 4. A day with no cause said: rain or storm (lost, or nothing done), or simply lost.
  for (const day of days) {
    if (claimed.has(day)) continue;
    const list = byDay.get(day)!;
    if (list.some((entry) => entry.lostDay && entry.lostCause !== null)) continue;
    const lost = list.some((entry) => entry.lostDay);
    const bad = list.some(
      (entry) => entry.weather !== null && WEATHER_LOST.includes(entry.weather),
    );
    const nothingDone = list.every((entry) => entry.done.length === 0);
    const cause: 'weather' | 'unstated' | null =
      bad && (lost || nothingDone) ? 'weather' : lost ? 'unstated' : null;
    if (cause === null) continue;
    const chain = onChain(day);
    if (chain.length === 0) continue;
    claimed.add(day);
    add(
      cause,
      cause,
      null,
      trace(`day:${day}`, {
        itemId: String(list[0]!.seq),
        title: day,
        day,
        days: 1,
        basis: cause,
        cause,
        activityIds: chain,
        seqs: list.map((entry) => entry.seq),
      }),
    );
  }

  // 5. Decisions made after their baseline deadline, capped at what their stage lost.
  const baselineStarts = baselineStageStarts(snapshot, baseline);
  const forecastStarts = new Map<string, string>();
  for (const activity of activities) {
    const start = ahead.dates.get(activity.id)?.start;
    const known = forecastStarts.get(activity.stageId);
    if (start !== undefined && (known === undefined || start < known)) {
      forecastStarts.set(activity.stageId, start);
    }
  }
  const capLeft = new Map<string, number>();
  for (const decision of decisionsInOrder(snapshot)) {
    const madeOn = decision.madeAt?.slice(0, 10) ?? null;
    const planned = baselineStarts.get(decision.stageId);
    const actual = forecastStarts.get(decision.stageId);
    const lead = decision.leadTimeDays;
    if (madeOn === null || !isIsoDay(madeOn) || planned === undefined || actual === undefined) {
      continue;
    }
    if (!Number.isInteger(lead) || lead < 0) continue;
    const deadline = subtractWorkingDays(calendar, planned, lead);
    if (madeOn <= deadline) continue;
    let left =
      capLeft.get(decision.stageId) ?? Math.max(0, workingDaysUntil(calendar, planned, actual));
    const last = madeOn < today ? madeOn : today;
    for (let day = addCalendarDays(deadline, 1); left > 0 && day <= last;) {
      if (isWorkingDay(calendar, day) && !claimed.has(day)) {
        claimed.add(day);
        left -= 1;
        add(
          'decision',
          'decision',
          { kind: 'owner' },
          trace(`day:${day}`, {
            itemId: decision.id,
            title: decision.name,
            day,
            days: 1,
            basis: 'decision',
            cause: 'decision',
            seqs: (byDay.get(day) ?? []).map((entry) => entry.seq),
            decisionId: decision.id,
          }),
        );
      }
      day = addCalendarDays(day, 1);
    }
    capLeft.set(decision.stageId, left);
  }

  // 6. A running critical activity with nothing done, its responsible not on site.
  for (const day of days) {
    if (claimed.has(day)) continue;
    const list = byDay.get(day)!;
    const present = new Set(list.flatMap((entry) => entry.present));
    const done = new Set(list.flatMap((entry) => entry.done.map((line) => line.activityId)));
    const away = critical.find(
      (activity) =>
        activity.responsibleId !== null &&
        running(activity.id, day) &&
        !done.has(activity.id) &&
        !present.has(activity.responsibleId),
    );
    if (away === undefined) continue;
    claimed.add(day);
    const personId = away.responsibleId!;
    add(
      'absence',
      'absence',
      { kind: 'person', personId, name: names.get(personId) ?? null },
      trace(`day:${day}`, {
        itemId: String(list[0]!.seq),
        title: day,
        day,
        days: 1,
        basis: 'absence',
        cause: 'absence',
        activityIds: [away.id],
        seqs: list.map((entry) => entry.seq),
      }),
    );
  }

  const ledgerEntries = [...lines.values()].sort(
    (a, b) => DELAY_BASES.indexOf(a.basis) - DELAY_BASES.indexOf(b.basis),
  );
  const attributed = ledgerEntries.reduce((sum, line) => sum + line.days, 0);
  const residual = total - attributed;

  return {
    status: 'late',
    forecast: ahead,
    baselineNumber: baseline.number,
    total,
    entries: ledgerEntries,
    attributed,
    unexplainedDays: Math.max(0, residual),
    madeUpDays: Math.max(0, -residual),
    figures: {
      total: totalFigure,
      byCause: byCauseFigure(ledgerEntries, total, residual),
      byParty: byPartyFigure(ledgerEntries, total, residual),
    },
  };
}

// ── Figures ──────────────────────────────────────────────────────────────────

/** The row of what is left, when anything is: every figure of the ledger ends with it. */
function residualOf(residual: number): { cause: DelayResidual; days: number } | null {
  if (residual > 0) return { cause: 'unexplained', days: residual };
  if (residual < 0) return { cause: 'made-up', days: residual };
  return null;
}

/**
 * Days late by cause: one row per cause, in the order causes are listed, then what is left. Every
 * row lies where the total does (`againstFinish`), and the rows' days add up to it exactly.
 */
function byCauseFigure(
  entries: readonly DelayEntry[],
  total: number,
  residual: number,
): Figure<DelayCauseRow> {
  const rows: DelayCauseRow[] = [];
  for (const cause of DELAY_CAUSES) {
    const of = entries.filter((line) => line.cause === cause);
    if (of.length === 0) continue;
    const days = of.reduce((sum, line) => sum + line.days, 0);
    const stated = of
      .filter((line) => line.basis === 'stated')
      .reduce((sum, line) => sum + line.days, 0);
    rows.push({
      key: `cause:${cause}`,
      itemId: null,
      title: cause,
      day: null,
      minutes: 0,
      days,
      againstFinish: total,
      cause,
      bases: DELAY_BASES.filter((basis) => of.some((line) => line.basis === basis)),
      statedDays: stated,
      inferredDays: days - stated,
      trace: sortTrace(of.flatMap((line) => line.rows)),
    });
  }
  const left = residualOf(residual);
  if (left !== null) {
    rows.push({
      key: left.cause,
      itemId: null,
      title: left.cause,
      day: null,
      minutes: 0,
      days: left.days,
      againstFinish: total,
      cause: left.cause,
      bases: [],
      statedDays: 0,
      inferredDays: 0,
      trace: [],
    });
  }
  return daysFigure('delay:by-cause', DELAY_LABEL_KEYS.byCause, total, rows);
}

const PARTY_ORDER: Record<DelayParty['kind'], number> = { owner: 0, person: 1, other: 2 };

function partyRank(party: DelayParty | null): number {
  return party === null ? 3 : PARTY_ORDER[party.kind];
}

function partyTitle(party: DelayParty | null): string {
  if (party === null) return '';
  return party.kind === 'person'
    ? (party.name ?? party.personId)
    : party.kind === 'other'
      ? party.name
      : '';
}

/**
 * Days late by party: the owner, then the people by name, then the others the record names, then
 * nobody, then what is left. Every row lies where the total does; the days add up to it exactly.
 */
function byPartyFigure(
  entries: readonly DelayEntry[],
  total: number,
  residual: number,
): Figure<DelayPartyRow> {
  const groups = new Map<string, { party: DelayParty | null; lines: DelayEntry[] }>();
  for (const line of entries) {
    const key = partyKey(line.party);
    const group = groups.get(key);
    if (group === undefined) groups.set(key, { party: line.party, lines: [line] });
    else group.lines.push(line);
  }
  const rows: DelayPartyRow[] = [...groups.entries()]
    .sort(
      ([keyA, a], [keyB, b]) =>
        partyRank(a.party) - partyRank(b.party) ||
        compareText(partyTitle(a.party), partyTitle(b.party)) ||
        compareText(keyA, keyB),
    )
    .map(([key, { party, lines }]) => ({
      key: `party:${key}`,
      itemId: party?.kind === 'person' ? party.personId : null,
      title: partyTitle(party),
      day: null,
      minutes: 0,
      days: lines.reduce((sum, line) => sum + line.days, 0),
      againstFinish: total,
      party,
      residual: null,
      causes: DELAY_CAUSES.filter((cause) => lines.some((line) => line.cause === cause)),
      trace: sortTrace(lines.flatMap((line) => line.rows)),
    }));
  const left = residualOf(residual);
  if (left !== null) {
    rows.push({
      key: left.cause,
      itemId: null,
      title: left.cause,
      day: null,
      minutes: 0,
      days: left.days,
      againstFinish: total,
      party: null,
      residual: left.cause,
      causes: [],
      trace: [],
    });
  }
  return daysFigure('delay:by-party', DELAY_LABEL_KEYS.byParty, total, rows);
}

/** Trace rows by day, oldest first; changes (filed under their decision day) among them. */
function sortTrace(rows: readonly DelayTraceRow[]): DelayTraceRow[] {
  return [...rows].sort(
    (a, b) => compareText(a.day ?? '', b.day ?? '') || compareText(a.key, b.key),
  );
}
