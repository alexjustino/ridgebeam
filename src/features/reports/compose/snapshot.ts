/**
 * The owner's snapshot, as a document (D4, decision 3): the work as it stands today, for the owner,
 * on a phone. The host renders it as one HTML page with no script and nothing loaded from anywhere
 * (decision 1) — headings, paragraphs, every figure a `<details>` that opens onto its rows, the
 * window's Gantt as an inline drawing, the diary's photos embedded — and the person sends it.
 *
 * **Always in the owner's words**, whatever lens is on screen — its nouns come from the owner's
 * vocabulary table (`termsFor(language, 'owner')`), as the weekly report's and the handover book's
 * do — and in the language on screen. In order:
 *
 * - **the title** is the glossary's term, _Owner's snapshot_ / _Retrato da obra_; the subtitle the
 *   work's name and the day it was written;
 * - **today**: the place, readiness — the figure with what the plan still lacks as its rows, and the
 *   sentence exactly as the dashboard says it — the finish date, and the finish as a chance (D1's
 *   headline, its drivers as rows) or the sentence that every activity is counted as certain;
 * - **the next two weeks** (the domain's `lookahead`): the days it covers, a small Gantt of the window
 *   when anything is placed, then what starts, what runs, who must be there, what to decide or order
 *   by its lead time, which gates come up, and what payment falls due — each a figure with its rows.
 *   With nothing placed it says the schedule has nothing on it yet, so an empty fortnight is never
 *   mistaken for a quiet one;
 * - **lately on site**: the last `SNAPSHOT_ENTRIES` effective diary entries, newest first, each with
 *   its note whole, what was done, who was there, and at most `SNAPSHOT_PHOTOS_PER_ENTRY` of its
 *   photos — half width, captioned with the day and the file — and how many more it has;
 * - **money**: planned, committed, paid, the commitments paid ahead of the work and what is earned
 *   and not paid now (D2), and what those leave out;
 * - **changes** (E1), once the plan is approved: what waits for the owner's decision, each change
 *   with who asked and how long it has waited, and the standing tally — the approved changes' money
 *   and working days, with who asked;
 * - **the closing line**: when Ridgebeam wrote it, and that a snapshot does not change when the work
 *   does.
 *
 * Nothing else. **No contact** — no phone number, no e-mail, not the Windows account that wrote an
 * entry: the file is made to be sent, and the handover book is where contacts belong. **No
 * documents.** A photo is named by the hash of a file the work holds (an image with its size, the
 * handover book's rule), so the host never refuses one; the host re-encodes every photo it embeds.
 *
 * The page is HTML, not WinAnsi: no string is folded (`printable` is the PDF's), but every string
 * keeps inside the host's limits (`REPORT_LIMITS`) — a note longer than one string is carried on as
 * many paragraphs as it takes, never cut.
 *
 * Pure: the work, its schedule, the diary, the chance, today and an `I18n` in; a `ReportDocument`
 * out. No clock, no host.
 */

import type { ReportBlock, ReportDocument } from '@/data/commands';
import type { ExpectedRow } from '@/domain/dashboard';
import { changeTally } from '@/domain/changes';
import type { DiaryEntry } from '@/domain/diary';
import type { Figure } from '@/domain/figure';
import { aheadFigure, MILESTONE_LABEL_KEYS, paymentPlans, type PlanRow } from '@/domain/milestones';
import { moneyOfWork, NOT_PRICED_KEY, type MoneyRow } from '@/domain/money';
import type { WorkSnapshot } from '@/domain/plan';
import { readiness, readinessFigure } from '@/domain/readiness';
import { diaryReport, type DiaryReportRow } from '@/domain/reports/diary';
import {
  lookahead,
  LOOKAHEAD_LABEL_KEYS,
  type FallingDueRow,
  type Lookahead,
  type LookaheadActivityRow,
  type LookaheadDecisionRow,
  type LookaheadGateRow,
} from '@/domain/reports/lookahead';
import type { Schedule } from '@/domain/schedule';
import type { FinishProbabilityResult } from '@/domain/schedule/probability';
import { pendingText, percentText, whenText } from '@/features/money/paymentPlanWords';
import type { MessageKey } from '@/i18n/en';
import { formatDayColumn, formatDayWeekday } from '@/i18n/format';
import { termsFor } from '@/i18n/terms';
import type { I18n } from '@/i18n/useI18n';

import { pieces, REPORT_LIMITS, shortened } from './document';
import { changeTallyBlocks, probabilityBlocks } from './weekly';
import { decisionStatusText, finishText, readinessRowText, readinessSentence } from './words';

/** How many diary entries "Lately on site" shows: the latest effective ones. */
export const SNAPSHOT_ENTRIES = 5;

/** How many photos of one entry the page embeds; the rest are counted, in words. */
export const SNAPSHOT_PHOTOS_PER_ENTRY = 2;

type Term = ReturnType<typeof termsFor>;

/** What the snapshot is composed from — everything the dashboard reads, and nothing else. */
export interface SnapshotInput {
  readonly snapshot: WorkSnapshot;
  readonly scheduled: Schedule;
  readonly entries: readonly DiaryEntry[];
  /** `finishProbability` over the same plan, schedule and diary (D1). */
  readonly probability: FinishProbabilityResult;
  /** The day it is written: the lookahead's first day, and the day the closing line names. */
  readonly today: string;
}

/** The words of one row: its parts joined the way the screen joins them, the empty ones left out. */
function row(...parts: ReadonlyArray<string | null | undefined | false>): string {
  return shortened(
    parts
      .filter((part): part is string => typeof part === 'string' && part.trim() !== '')
      .join(' — '),
    REPORT_LIMITS.text,
  );
}

function figure(label: string, value: string, rows: readonly string[]): ReportBlock {
  return { type: 'figure', label, value, rows: [...rows] };
}

/** A text as many paragraphs as the host's string limit asks, never cut. */
function paragraphs(text: string): ReportBlock[] {
  return pieces(text).map((piece): ReportBlock => ({ type: 'paragraph', text: piece }));
}

/** A day of the fortnight, as the owner says it: "Monday, Oct 5". */
function dayOf(i18n: Pick<I18n, 'language'>, day: string): string {
  return formatDayWeekday(i18n.language, day);
}

/** An activity's name with its breakdown number, as the breakdown shows it: "1.2 Lay the tiles". */
function activityName(number: string | null, name: string): string {
  return [number, name].filter((part) => part !== null && part !== '').join(' ');
}

/** Who answers for an activity, in the owner's words: "who does it: João", or that nobody does yet. */
function responsibleText(i18n: Pick<I18n, 't'>, term: Term, name: string | null): string {
  return name === null
    ? i18n.t('reports.snapshot.nobody', { responsible: term('responsible') })
    : i18n.t('reports.snapshot.responsible', { responsible: term('responsible'), name });
}

// ── Today ────────────────────────────────────────────────────────────────────

function todayBlocks(input: SnapshotInput, i18n: I18n, term: Term): ReportBlock[] {
  const { snapshot, scheduled, probability, today } = input;
  const { t, tp, number } = i18n;
  const blocks: ReportBlock[] = [];
  blocks.push({ type: 'heading', level: 1, text: t('reports.snapshot.today') });
  if (snapshot.work.place.trim() !== '') {
    blocks.push({ type: 'paragraph', tone: 'strong', text: snapshot.work.place });
  }

  // Readiness: the figure with what the plan lacks, and the sentence the dashboard says — the two
  // readings from the same rows in the same call.
  const measure = readiness(snapshot, { schedule: scheduled, today });
  const ready = readinessFigure(measure);
  blocks.push(
    figure(
      term('readiness', { capital: true }),
      t('figure.percent', { value: number(ready.value) }),
      ready.rows.map((each) => row(each.title, each.stageName, readinessRowText(i18n, each))),
    ),
  );
  blocks.push({ type: 'paragraph', text: readinessSentence(i18n, measure.missing) });

  // The finish: the plan's date, then its chance.
  const leftOut = scheduled.unplaced.filter((each) => each.reason === 'no-duration').length;
  blocks.push(
    figure(
      term('finishDate', { capital: true }),
      finishText(i18n, scheduled),
      scheduled.finishDate !== null && leftOut > 0 ? [tp('dashboard.finish.leftOut', leftOut)] : [],
    ),
  );
  blocks.push(...probabilityBlocks(i18n, probability));
  return blocks;
}

// ── The next two weeks ───────────────────────────────────────────────────────

function activityRows(
  i18n: I18n,
  term: Term,
  rows: readonly LookaheadActivityRow[],
  when: 'starts' | 'runs',
): string[] {
  return rows.map((each) =>
    row(
      activityName(each.number, each.title),
      each.stageName,
      when === 'starts'
        ? i18n.t('reports.snapshot.starts', {
            day: dayOf(i18n, each.start),
            finish: dayOf(i18n, each.finish),
          })
        : i18n.t('reports.snapshot.runs', { finish: dayOf(i18n, each.finish) }),
      responsibleText(i18n, term, each.responsibleName),
      each.critical ? i18n.t('reports.snapshot.critical') : null,
    ),
  );
}

function peopleRows(i18n: I18n, snapshot: WorkSnapshot, rows: readonly ExpectedRow[]): string[] {
  const activities = new Map(snapshot.activities.map((each) => [each.id, each.name]));
  const stages = new Map(snapshot.stages.map((each) => [each.id, each.name]));
  return rows.map((each) =>
    row(
      each.title,
      each.trade,
      each.activityIds
        .map((id) => activities.get(id) ?? '')
        .filter((name) => name !== '')
        .join(', '),
      each.stageIds.length === 0
        ? null
        : i18n.t('dashboard.expected.stages', {
            stages: each.stageIds.map((id) => stages.get(id) ?? '').join(', '),
          }),
    ),
  );
}

function decisionRowsText(i18n: I18n, term: Term, rows: readonly LookaheadDecisionRow[]): string[] {
  return rows.map((each) =>
    row(
      each.title,
      each.stageName,
      i18n.t('reports.snapshot.decideBy', { day: dayOf(i18n, each.deadline) }),
      decisionStatusText(i18n, { status: each.status, daysLeft: each.daysLeft, madeAt: null }),
      i18n.tp('reports.snapshot.leadTime', each.leadTimeDays, {
        leadTime: term('leadTime', { capital: true }),
        day: dayOf(i18n, each.neededBy),
      }),
    ),
  );
}

function gateRows(i18n: I18n, rows: readonly LookaheadGateRow[]): string[] {
  return rows.map((each) => {
    const holding = each.holding.map((item) => item.check.name).join('; ');
    return row(
      i18n.t(each.messageKey as MessageKey, { stage: each.title, day: dayOf(i18n, each.day) }),
      each.checks === 0
        ? i18n.t('reports.snapshot.gate.noChecks')
        : each.passed
          ? i18n.t('reports.snapshot.gate.passed')
          : i18n.tp('reports.snapshot.gate.holding', each.holding.length, { items: holding }),
    );
  });
}

function fallingDueRows(i18n: I18n, rows: readonly FallingDueRow[], currency: string): string[] {
  return rows.map((each) =>
    row(
      each.commitmentLabel,
      `${each.title} (${percentText(i18n, each.shareBp)})`,
      whenText(i18n, each.trigger, each.target),
      dayOf(i18n, each.day),
      i18n.money(each.amountCents, currency),
      each.coveredCents > 0
        ? i18n.t('reports.snapshot.covered', { amount: i18n.money(each.coveredCents, currency) })
        : null,
    ),
  );
}

function nextTwoWeeksBlocks(
  input: SnapshotInput,
  ahead: Lookahead,
  i18n: I18n,
  term: Term,
): ReportBlock[] {
  const { snapshot } = input;
  const { t, number, money } = i18n;
  const currency = snapshot.work.currency;
  const blocks: ReportBlock[] = [];
  blocks.push({ type: 'heading', level: 1, text: t('reports.snapshot.next.title') });
  blocks.push({
    type: 'paragraph',
    tone: 'muted',
    // A day can end in an abbreviation's own full stop ("15 de out."); the sentence's is not added.
    text: t('reports.snapshot.next.window', {
      from: dayOf(i18n, ahead.window.from),
      to: dayOf(i18n, ahead.window.to),
    }).replace(/\.\.$/, '.'),
  });
  if (!ahead.placed) {
    blocks.push({
      type: 'paragraph',
      tone: 'strong',
      text: t('reports.snapshot.next.nothingPlaced'),
    });
  }

  // The window drawn, when anything is in it: one column a calendar day, one bar an activity.
  if (ahead.bars.length > 0) {
    blocks.push({
      type: 'gantt',
      days: ahead.window.days.length,
      dayLabels: ahead.window.days.map((each) => formatDayColumn(i18n.language, each.date)),
      rows: ahead.bars.map((bar) => ({
        label: shortened(activityName(bar.number, bar.name), REPORT_LIMITS.text),
        start: bar.start,
        length: bar.length,
        critical: bar.critical,
        baselineStart: null,
        baselineLength: null,
      })),
    });
    blocks.push({ type: 'paragraph', tone: 'muted', text: t('reports.snapshot.next.chart') });
  }

  blocks.push(
    figure(
      t(LOOKAHEAD_LABEL_KEYS.starting as MessageKey),
      number(ahead.starting.value),
      activityRows(i18n, term, ahead.starting.rows, 'starts'),
    ),
  );
  blocks.push(
    figure(
      t(LOOKAHEAD_LABEL_KEYS.running as MessageKey),
      number(ahead.running.value),
      activityRows(i18n, term, ahead.running.rows, 'runs'),
    ),
  );
  blocks.push(
    figure(
      t(LOOKAHEAD_LABEL_KEYS.people as MessageKey),
      number(ahead.people.value),
      peopleRows(i18n, snapshot, ahead.people.rows),
    ),
  );
  blocks.push(
    figure(
      t(LOOKAHEAD_LABEL_KEYS.decisions as MessageKey),
      number(ahead.decisions.value),
      decisionRowsText(i18n, term, ahead.decisions.rows),
    ),
  );
  blocks.push(
    figure(
      t(LOOKAHEAD_LABEL_KEYS.gates as MessageKey),
      number(ahead.gates.value),
      gateRows(i18n, ahead.gates.rows),
    ),
  );
  blocks.push(
    figure(
      t(LOOKAHEAD_LABEL_KEYS.fallingDue as MessageKey),
      money(ahead.payments.fallingDue.value, currency),
      fallingDueRows(i18n, ahead.payments.fallingDue.rows, currency),
    ),
  );
  return blocks;
}

// ── Lately on site ───────────────────────────────────────────────────────────

/** The latest effective entries, newest day first (and, on one day, the last written first). */
function latest(rows: readonly DiaryReportRow[]): DiaryReportRow[] {
  return rows
    .filter((each) => each.status === 'effective')
    .sort((a, b) => (a.day === b.day ? b.seq - a.seq : a.day < b.day ? 1 : -1))
    .slice(0, SNAPSHOT_ENTRIES);
}

function latelyBlocks(input: SnapshotInput, i18n: I18n, term: Term): ReportBlock[] {
  const { snapshot, entries } = input;
  const { t, tp, number } = i18n;
  const blocks: ReportBlock[] = [];
  blocks.push({ type: 'heading', level: 1, text: t('reports.snapshot.lately.title') });

  // Only a photo the work holds — a document of the work names its hash, with its size — is asked
  // of the host, which refuses any other (D3's rule).
  const images = new Map<string, string>();
  for (const document of input.snapshot.documents) {
    if (document.width !== null && document.height !== null && !images.has(document.fileHash)) {
      images.set(document.fileHash, document.fileName);
    }
  }

  const report = diaryReport(snapshot, entries);
  const shown = latest(report.rows);
  if (shown.length === 0) {
    blocks.push({ type: 'paragraph', tone: 'muted', text: t('reports.snapshot.lately.none') });
    return blocks;
  }
  if (report.effective > shown.length) {
    blocks.push({
      type: 'paragraph',
      tone: 'muted',
      text: t('reports.snapshot.lately.of', {
        shown: number(shown.length),
        all: number(report.effective),
        entry: term('entry'),
      }),
    });
  }

  for (const entry of shown) {
    blocks.push({ type: 'heading', level: 2, text: dayOf(i18n, entry.day) });
    if (entry.note !== null && entry.note.trim() !== '') {
      blocks.push(...paragraphs(entry.note));
    }
    if (entry.lostDay) {
      blocks.push({ type: 'paragraph', tone: 'muted', text: t('diary.entry.lostDay') });
    }
    if (entry.done.length > 0) {
      blocks.push(
        figure(
          t('reports.snapshot.lately.done'),
          number(entry.done.length),
          entry.done.map((line) =>
            row(
              t(line.state === 'finished' ? 'diary.entry.finished' : 'diary.entry.worked', {
                name:
                  line.name === null
                    ? t('diary.entry.unknownActivity')
                    : activityName(line.number, line.name),
              }),
              line.note,
            ),
          ),
        ),
      );
    }
    if (entry.present.length > 0) {
      blocks.push({
        type: 'paragraph',
        tone: 'muted',
        text: shortened(
          t('diary.entry.present', {
            names: entry.present
              .map((person) => person.name ?? t('reports.diary.unknownPerson'))
              .join(', '),
          }),
          REPORT_LIMITS.text,
        ),
      });
    }
    const held = entry.photoHashes.filter((hash) => images.has(hash));
    const unique = [...new Set(held)];
    for (const hash of unique.slice(0, SNAPSHOT_PHOTOS_PER_ENTRY)) {
      blocks.push({
        type: 'image',
        hash,
        caption: shortened(
          t('reports.snapshot.lately.photo', {
            day: dayOf(i18n, entry.day),
            name: images.get(hash) ?? '',
          }),
          REPORT_LIMITS.text,
        ),
        size: 'half',
      });
    }
    const more = entry.photoCount - Math.min(unique.length, SNAPSHOT_PHOTOS_PER_ENTRY);
    if (more > 0) {
      blocks.push({
        type: 'paragraph',
        tone: 'muted',
        text: tp('reports.snapshot.lately.morePhotos', more),
      });
    }
  }
  return blocks;
}

// ── Money ────────────────────────────────────────────────────────────────────

function moneyRows(i18n: I18n, figureOf: Figure<MoneyRow>, currency: string): string[] {
  return figureOf.rows.map((each) =>
    row(
      each.label,
      each.day === null ? null : i18n.day(each.day),
      each.priced ? i18n.money(each.amountCents, currency) : i18n.t(NOT_PRICED_KEY as MessageKey),
    ),
  );
}

/** A commitment's row of a payment-plan figure: its name, the mark in words, what it waits for. */
function planRows(
  i18n: I18n,
  snapshot: WorkSnapshot,
  figureOf: Figure<PlanRow>,
  mark: 'money.paymentPlan.paidAhead.mark' | 'money.paymentPlan.dueNow.mark',
): string[] {
  const currency = snapshot.work.currency;
  const names = new Map(snapshot.commitments.map((each) => [each.id, each.label]));
  return figureOf.rows.map((each) =>
    row(
      names.get(each.commitmentId) ?? each.title,
      i18n.t(mark, { amount: i18n.money(each.amountCents, currency) }),
      each.next === null
        ? null
        : `${each.next.label} (${percentText(i18n, each.next.shareBp)}): ${pendingText(i18n, each.next)}`,
    ),
  );
}

function moneyBlocks(
  input: SnapshotInput,
  ahead: Lookahead,
  i18n: I18n,
  term: Term,
): ReportBlock[] {
  const { snapshot, entries, today } = input;
  const { t, tp, number, money } = i18n;
  const currency = snapshot.work.currency;
  const blocks: ReportBlock[] = [];
  blocks.push({ type: 'heading', level: 1, text: t('nav.money') });
  const work = moneyOfWork(snapshot);
  for (const name of ['planned', 'committed', 'paid'] as const) {
    blocks.push(
      figure(
        term(name, { capital: true }),
        money(work[name].value, currency),
        moneyRows(i18n, work[name], currency),
      ),
    );
  }
  const paidAhead = aheadFigure(snapshot, entries, today);
  blocks.push(
    figure(
      t(MILESTONE_LABEL_KEYS.paidAhead),
      number(paidAhead.value),
      planRows(i18n, snapshot, paidAhead, 'money.paymentPlan.paidAhead.mark'),
    ),
  );
  // Earned and not paid now: the lookahead's, which is D2's own figure.
  const due = ahead.payments.dueNow;
  blocks.push(
    figure(
      t(MILESTONE_LABEL_KEYS.dueNow),
      money(due.value, currency),
      planRows(i18n, snapshot, due, 'money.paymentPlan.dueNow.mark'),
    ),
  );
  const plans = paymentPlans(snapshot, entries, today);
  const leftOut = [
    plans.noPlan.value > 0 ? tp('dashboard.money.noPlan', plans.noPlan.value) : null,
    plans.outside.value > 0 ? tp('dashboard.money.outside', plans.outside.value) : null,
  ].filter((each): each is string => each !== null);
  if (leftOut.length > 0) {
    blocks.push({ type: 'paragraph', tone: 'muted', text: leftOut.join(' ') });
  }
  return blocks;
}

// ── Changes (E1) ─────────────────────────────────────────────────────────────

/**
 * What waits for the owner's decision, and the standing tally of change orders — once the plan is
 * approved; before that there are none. The weekly report prints the same blocks.
 */
function changeBlocks(input: SnapshotInput, i18n: I18n): ReportBlock[] {
  const { snapshot, today } = input;
  if (snapshot.work.approvedAt === null) return [];
  return [
    { type: 'heading', level: 1, text: i18n.t('reports.snapshot.changes.title') },
    ...changeTallyBlocks(
      i18n,
      snapshot,
      changeTally(snapshot, today),
      i18n.t('reports.snapshot.changes.waiting'),
    ),
  ];
}

// ── The snapshot ─────────────────────────────────────────────────────────────

/** The owner's snapshot of the work as it stands on `input.today`, in `i18n`'s language. */
export function composeSnapshot(input: SnapshotInput, i18n: I18n): ReportDocument {
  const { snapshot, scheduled, entries, today } = input;
  const { t, day } = i18n;
  const term = termsFor(i18n.language, 'owner');
  const ahead = lookahead(snapshot, scheduled, entries, today);

  const blocks: ReportBlock[] = [
    ...todayBlocks(input, i18n, term),
    ...nextTwoWeeksBlocks(input, ahead, i18n, term),
    ...latelyBlocks(input, i18n, term),
    ...moneyBlocks(input, ahead, i18n, term),
    ...changeBlocks(input, i18n),
    { type: 'rule' },
    { type: 'paragraph', tone: 'muted', text: t('reports.snapshot.closing', { day: day(today) }) },
  ];

  return {
    kind: 'snapshot',
    title: term('snapshot', { capital: true }),
    subtitle: t('reports.snapshot.subtitle', { work: snapshot.work.name, day: day(today) }),
    // A page has no paper size; the model asks for one, and the HTML renderer ignores it.
    pageSize: 'a4',
    language: i18n.language,
    blocks,
  };
}
