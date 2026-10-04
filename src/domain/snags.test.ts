import { describe, expect, it } from 'vitest';

import { activity, person, snag, snagClosure, snapshot, stage } from './__fixtures__/plan';
import { traceable } from './figure';
import type { Document, WorkSnapshot } from './plan';
import {
  SNAG_LABEL_KEYS,
  SNAG_LIMITS,
  SNAG_MESSAGE_KEYS,
  SNAG_PROBLEM_KEYS,
  SNAG_STATE_KEYS,
  SNAG_STATES,
  snagFigures,
  snagHold,
  snagRows,
  snagState,
  validateSnagClosure,
  validateSnagDraft,
  type SnagClosureDraft,
  type SnagDraft,
} from './snags';

// ── Builders. Nothing in them is a real place, person or brand. ──────────────

/** Monday 28 September 2026. */
const TODAY = '2026-09-28';

const h = (label: string) => label.padEnd(64, '0');

const image = (label: string): Document => ({
  id: `doc-${label}`,
  fileHash: h(label),
  fileName: `${label}.jpg`,
  mediaType: 'image/jpeg',
  bytes: 2_048,
  width: 800,
  height: 600,
  kind: 'photo',
  title: `Title ${label}`,
  addedOn: '2026-09-21',
  authorName: 'Sample author',
  createdAt: '2026-09-21T12:00:00.000Z',
  links: [],
});

/** Two stages, an activity in the first, two people. */
const BASE: WorkSnapshot = snapshot({
  stages: [stage('wet', 1, 'Wet areas'), stage('paint', 2, 'Painting')],
  activities: [{ ...activity('tile', 'wet', 1, 3), name: 'Lay the tiles' }],
  people: [person('tiler', 'Tiler'), person('painter', 'Painter')],
  documents: [image('problem'), image('fixed')],
});

const withSnags = (...snags: WorkSnapshot['snags']): WorkSnapshot => ({ ...BASE, snags });

// ── The record, read ─────────────────────────────────────────────────────────

describe('a snag’s state', () => {
  it('is open until its closure, then how it was closed', () => {
    expect(snagState(snag('a', 1, 'wet'))).toBe('open');
    expect(snagState(snag('a', 1, 'wet', { closure: snagClosure('fixed', TODAY) }))).toBe('fixed');
    expect(snagState(snag('a', 1, 'wet', { closure: snagClosure('withdrawn', TODAY) }))).toBe(
      'withdrawn',
    );
    expect(Object.keys(SNAG_STATE_KEYS)).toEqual([...SNAG_STATES]);
  });
});

describe('the snag list', () => {
  const plan = withSnags(
    snag('closed-1', 1, 'wet', {
      personId: 'tiler',
      closure: snagClosure('fixed', '2026-09-24', h('fixed')),
      photoHash: h('problem'),
    }),
    snag('late', 2, 'wet', {
      activityId: 'tile',
      personId: 'tiler',
      dueOn: '2026-09-25',
      photoHash: h('problem'),
    }),
    snag('due-today', 3, 'paint', { personId: 'painter', dueOn: TODAY }),
    snag('withdrawn', 4, 'paint', { closure: snagClosure('withdrawn', '2026-09-22') }),
    snag('no-day', 5, 'paint'),
  );

  it('lists the open snags first, then the closed ones, each by number', () => {
    expect(snagRows(plan, TODAY).map((row) => [row.snagId, row.state])).toEqual([
      ['late', 'open'],
      ['due-today', 'open'],
      ['no-day', 'open'],
      ['closed-1', 'fixed'],
      ['withdrawn', 'withdrawn'],
    ]);
  });

  it('names where it is and who must fix it, from the plan', () => {
    const late = snagRows(plan, TODAY).find((row) => row.snagId === 'late')!;
    expect(late).toMatchObject({
      key: 'snag:late',
      itemId: 'late',
      title: 'Snag late',
      day: '2026-09-21',
      stageName: 'Wet areas',
      activityName: 'Lay the tiles',
      personName: 'Tiler',
      photoHash: h('problem'),
      closedOn: null,
      fixPhotoHash: null,
    });
  });

  it('marks overdue by its due day: a day before today is late, today is still in time', () => {
    const rows = new Map(snagRows(plan, TODAY).map((row) => [row.snagId, row]));
    expect(rows.get('late')).toMatchObject({ overdue: true, overdueDays: 3 });
    expect(rows.get('due-today')).toMatchObject({ overdue: false, overdueDays: null });
    expect(rows.get('no-day')).toMatchObject({ overdue: false, overdueDays: null });
  });

  it('never marks a closed snag overdue, whatever its day', () => {
    const closedLate = withSnags(
      snag('x', 1, 'wet', { dueOn: '2026-09-22', closure: snagClosure('fixed', '2026-09-26') }),
    );
    expect(snagRows(closedLate, TODAY)[0]).toMatchObject({ overdue: false, overdueDays: null });
  });

  it('counts how long an open snag has waited, and how long a closed one took', () => {
    const rows = new Map(snagRows(plan, TODAY).map((row) => [row.snagId, row]));
    expect(rows.get('late')).toMatchObject({ waitedDays: 7, tookDays: null });
    expect(rows.get('closed-1')).toMatchObject({
      waitedDays: null,
      tookDays: 3,
      closedOn: '2026-09-24',
      fixPhotoHash: h('fixed'),
    });
    expect(rows.get('withdrawn')).toMatchObject({ tookDays: 1, note: 'Raised by mistake' });
  });

  it('says nothing overdue and counts no wait when today is not a day', () => {
    for (const row of snagRows(plan, 'someday')) {
      expect(row.overdue).toBe(false);
      expect(row.waitedDays).toBeNull();
    }
  });

  it('keeps a snag whose stage, activity or person is gone, with no name', () => {
    const gone = withSnags(
      snag('orphan', 1, 'gone-stage', { activityId: 'gone-activity', personId: 'gone-person' }),
    );
    expect(snagRows(gone, TODAY)[0]).toMatchObject({
      stageName: null,
      activityName: null,
      personName: null,
    });
  });
});

// ── The figures ──────────────────────────────────────────────────────────────

describe('what is still open, and on whom', () => {
  const plan = withSnags(
    snag('a', 1, 'wet', { personId: 'tiler', dueOn: '2026-09-25' }),
    snag('b', 2, 'paint', { personId: 'painter', dueOn: '2026-09-27' }),
    snag('c', 3, 'wet', { personId: 'tiler' }),
    snag('d', 4, 'wet'),
    snag('e', 5, 'paint', { personId: 'gone' }),
    snag('f', 6, 'paint', { personId: 'painter', closure: snagClosure('fixed', '2026-09-25') }),
    snag('g', 7, 'wet', { personId: 'tiler', closure: snagClosure('withdrawn', '2026-09-25') }),
  );
  const figures = snagFigures(plan, TODAY);

  it('counts open and overdue, each with its rows, the latest first for overdue', () => {
    expect(figures.open).toMatchObject({ id: 'snags:open', label: SNAG_LABEL_KEYS.open, value: 5 });
    expect(figures.open.rows.map((row) => row.snagId)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(figures.overdue).toMatchObject({ label: SNAG_LABEL_KEYS.overdue, value: 2 });
    expect(figures.overdue.rows.map((row) => row.snagId)).toEqual(['a', 'b']);
    expect(traceable(figures.open)).toBe(true);
    expect(traceable(figures.overdue)).toBe(true);
  });

  it('says how many were ever raised, fixed and withdrawn', () => {
    expect(figures).toMatchObject({ raised: 7, fixed: 1, withdrawn: 1 });
  });

  it('groups the open snags by person: the plan’s by name, then the gone, then nobody', () => {
    expect(figures.byPerson.map((group) => [group.key, group.name, group.open.value])).toEqual([
      ['person:painter', 'Painter', 1],
      ['person:tiler', 'Tiler', 2],
      ['person:gone', null, 1],
      ['nobody', null, 1],
    ]);
    const tiler = figures.byPerson[1]!;
    expect(tiler.overdue.rows.map((row) => row.snagId)).toEqual(['a']);
    expect(figures.byPerson[3]!.open.label).toBe(SNAG_LABEL_KEYS.nobody);
    expect(tiler.open.label).toBe(SNAG_LABEL_KEYS.onPerson);
  });

  it('groups them by stage, in plan order, leaving out a stage with none open', () => {
    expect(figures.byStage.map((group) => [group.stageId, group.name, group.open.value])).toEqual([
      ['wet', 'Wet areas', 3],
      ['paint', 'Painting', 2],
    ]);
    const quiet = snagFigures(withSnags(snag('x', 1, 'paint')), TODAY);
    expect(quiet.byStage.map((group) => group.stageId)).toEqual(['paint']);
  });

  it('is traceable throughout: every group a figure, the groups together the open rows', () => {
    const all = [...figures.byPerson, ...figures.byStage];
    for (const group of all) {
      expect(traceable(group.open)).toBe(true);
      expect(traceable(group.overdue)).toBe(true);
    }
    const ids = (groups: typeof figures.byPerson | typeof figures.byStage) =>
      groups.flatMap((group) => group.open.rows.map((row) => row.snagId)).sort();
    expect(ids(figures.byPerson)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(ids(figures.byStage)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('is nothing, with nothing raised, for a work that never had a snag', () => {
    const none = snagFigures(BASE, TODAY);
    expect(none).toMatchObject({ raised: 0, fixed: 0, withdrawn: 0, byPerson: [], byStage: [] });
    expect(none.open.value).toBe(0);
  });
});

// ── What retention asks of the list ──────────────────────────────────────────

describe('what a stage’s snags on a person hold', () => {
  it('lists the open ones by number and the day the last closed one was closed', () => {
    const plan = withSnags(
      snag('b', 2, 'wet', { personId: 'tiler' }),
      snag('a', 1, 'wet', { personId: 'tiler' }),
      snag('fixed', 3, 'wet', { personId: 'tiler', closure: snagClosure('fixed', '2026-09-26') }),
      snag('out', 4, 'wet', { personId: 'tiler', closure: snagClosure('withdrawn', '2026-09-27') }),
    );
    const hold = snagHold(plan, 'wet', 'tiler');
    expect(hold.open.map((each) => each.id)).toEqual(['a', 'b']);
    expect(hold.lastClosedOn).toBe('2026-09-27');
  });

  it('counts only that stage and that person; a snag on nobody holds nothing', () => {
    const plan = withSnags(
      snag('other-person', 1, 'wet', { personId: 'painter' }),
      snag('other-stage', 2, 'paint', { personId: 'tiler' }),
      snag('nobody', 3, 'wet'),
    );
    expect(snagHold(plan, 'wet', 'tiler')).toEqual({ open: [], lastClosedOn: null });
    expect(snagHold(plan, 'wet', null)).toEqual({ open: [], lastClosedOn: null });
  });
});

// ── Checking before the host is asked ────────────────────────────────────────

describe('checking a snag before it is raised', () => {
  const draft = (parts: Partial<SnagDraft> = {}): SnagDraft => ({
    title: 'Grout cracked',
    description: null,
    stageId: 'wet',
    activityId: 'tile',
    personId: 'tiler',
    raisedOn: '2026-09-21',
    dueOn: '2026-09-25',
    photoHash: h('problem'),
    ...parts,
  });
  const codes = (parts: Partial<SnagDraft>) =>
    validateSnagDraft(BASE, draft(parts)).map((each) => each.code);

  it('accepts a whole snag, and one on a closed stage', () => {
    expect(validateSnagDraft(BASE, draft())).toEqual([]);
    const closed = {
      ...BASE,
      stages: [{ ...stage('wet', 1), closedAt: '2026-09-20T12:00:00.000Z' }],
    };
    expect(validateSnagDraft(closed, draft())).toEqual([]);
    expect(codes({ activityId: null, personId: null, dueOn: null, photoHash: null })).toEqual([]);
  });

  it('refuses what the host refuses, each with its message key', () => {
    expect(codes({ title: '  ' })).toEqual(['title-empty']);
    expect(codes({ title: 'x'.repeat(SNAG_LIMITS.title + 1) })).toEqual(['title-too-long']);
    expect(codes({ title: '🧱'.repeat(SNAG_LIMITS.title) })).toEqual([]);
    expect(codes({ description: 'x'.repeat(SNAG_LIMITS.description + 1) })).toEqual([
      'description-too-long',
    ]);
    expect(codes({ stageId: 'nowhere', activityId: null })).toEqual(['unknown-stage']);
    expect(codes({ activityId: 'nothing' })).toEqual(['unknown-activity']);
    expect(codes({ stageId: 'paint' })).toEqual(['activity-of-another-stage']);
    expect(codes({ personId: 'nobody' })).toEqual(['unknown-person']);
    expect(codes({ raisedOn: '21/09/2026' })).toEqual(['invalid-raised-on']);
    expect(codes({ dueOn: 'soon' })).toEqual(['invalid-due-on']);
    expect(codes({ dueOn: '2026-09-20' })).toEqual(['due-before-raised']);
    expect(codes({ photoHash: h('not-held') })).toEqual(['unknown-photo']);
    const [refused] = validateSnagDraft(BASE, draft({ title: '' }));
    expect(refused!.messageKey).toBe(SNAG_PROBLEM_KEYS['title-empty']);
  });
});

describe('checking a closure before it is recorded', () => {
  const plan = withSnags(
    snag('open', 1, 'wet', { raisedOn: '2026-09-21' }),
    snag('done', 2, 'wet', { closure: snagClosure('fixed', '2026-09-22') }),
  );
  const draft = (parts: Partial<SnagClosureDraft> = {}): SnagClosureDraft => ({
    snagId: 'open',
    outcome: 'fixed',
    closedOn: '2026-09-25',
    photoHash: h('fixed'),
    note: null,
    ...parts,
  });
  const codes = (parts: Partial<SnagClosureDraft>) =>
    validateSnagClosure(plan, draft(parts)).map((each) => each.code);

  it('accepts a fix with its photo, and a withdrawal with its reason', () => {
    expect(codes({})).toEqual([]);
    expect(codes({ outcome: 'withdrawn', photoHash: null, note: 'Raised twice' })).toEqual([]);
    expect(codes({ closedOn: '2026-09-21' })).toEqual([]);
  });

  it('refuses a fix with no photo, a withdrawal with no reason, and a second closure', () => {
    expect(codes({ photoHash: null })).toEqual(['photo-required']);
    expect(codes({ outcome: 'withdrawn', photoHash: null, note: '  ' })).toEqual(['note-required']);
    expect(codes({ snagId: 'done' })).toEqual(['already-closed']);
    expect(codes({ snagId: 'missing' })).toEqual(['unknown-snag']);
  });

  it('refuses a closure dated before the snag, a day that is not one, and the rest', () => {
    expect(codes({ closedOn: '2026-09-20' })).toEqual(['closed-before-raised']);
    expect(codes({ closedOn: 'today' })).toEqual(['invalid-closed-on']);
    expect(codes({ photoHash: h('not-held') })).toEqual(['unknown-photo']);
    expect(codes({ note: 'x'.repeat(SNAG_LIMITS.note + 1) })).toEqual(['note-too-long']);
    expect(codes({ outcome: 'lost' as SnagClosureDraft['outcome'] })).toEqual(['invalid-outcome']);
  });
});

describe('the words', () => {
  it('are message keys, each once, all exported for the dictionaries', () => {
    expect(new Set(SNAG_MESSAGE_KEYS).size).toBe(SNAG_MESSAGE_KEYS.length);
    for (const key of SNAG_MESSAGE_KEYS) expect(key).toMatch(/^snags\.[a-z]+\.[a-zA-Z]+$/);
  });
});
