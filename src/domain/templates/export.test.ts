import { describe, expect, it } from 'vitest';

import {
  activity,
  decision,
  entry,
  finished,
  link,
  onStage,
  snapshot,
  stage,
  worked,
} from '../__fixtures__/plan';
import { libraryOf, sampleTemplate, snapshotFromDraft } from '../__fixtures__/templates';
import type { DiaryEntry } from '../diary';
import type { Activity, WorkSnapshot } from '../plan';
import { applyTemplate } from './apply';
import { exportTemplate, keyFrom, templateText, type ExportOptions } from './export';
import type { Template } from './format';
import { validateTemplate } from './validate';

const NONE = new Map<string, Template>();

const options = (parts: Partial<ExportOptions> = {}): ExportOptions => ({
  numbers: 'strip',
  language: 'en',
  id: 'my-bathroom',
  title: 'My bathroom',
  ...parts,
});

/**
 * A work somebody planned: a room, two stages, activities with and without a template's range and
 * with and without a duration, checks, cost lines priced and not, decisions with and without a range,
 * and links with lag, including one onto a stage.
 */
const WORK: WorkSnapshot = snapshot({
  rooms: [
    { id: 'r2', position: 2, name: 'Hall' },
    { id: 'r1', position: 1, name: 'Bathroom' },
  ],
  stages: [stage('s1', 1, 'Strip-out'), stage('s2', 2, 'Finishes'), stage('s3', 3, 'Finishes')],
  activities: [
    {
      ...activity('a1', 's1', 1, 2),
      name: 'Remove tiles',
      durationMinDays: 1,
      durationMaxDays: 3,
      roomIds: ['r2', 'r1', 'gone'],
    },
    { ...activity('a2', 's1', 2, 5), name: 'Remove tiles', durationMinDays: 1, durationMaxDays: 3 },
    { ...activity('a3', 's1', 3, null), name: 'Haul', durationMinDays: 2, durationMaxDays: 4 },
    { ...activity('a4', 's2', 1, 4), name: 'Lay tiles' },
    { ...activity('a5', 's2', 2, null), name: 'Grout' },
    { ...activity('orphan', 'nowhere', 1, 3), name: 'Orphan' },
  ],
  checks: [
    {
      id: 'c2',
      stageId: 's1',
      gate: 'start',
      position: 2,
      name: 'Is the power off?',
      needsPhoto: false,
    },
    {
      id: 'c1',
      stageId: 's1',
      gate: 'start',
      position: 1,
      name: 'Is the water off?',
      needsPhoto: false,
    },
    {
      id: 'c4',
      stageId: 's2',
      gate: 'close',
      position: 1,
      name: 'Is the grout sealed?',
      needsPhoto: false,
    },
    {
      id: 'c3',
      stageId: 's2',
      gate: 'close',
      position: 1,
      name: 'Is the floor clean?',
      needsPhoto: false,
    },
  ],
  costLines: [
    { id: 'l1', stageId: 's1', activityId: null, label: 'Skip hire', amountCents: 450_00 },
    { id: 'l2', stageId: 's1', activityId: 'a1', label: 'Labour', amountCents: null },
    { id: 'l3', stageId: 's2', activityId: 'a4', label: 'Tiles', amountCents: 0 },
  ],
  decisions: [
    { ...decision('d1', 's1', 1, 12), name: 'Which tile', leadMinDays: 5, leadMaxDays: 10 },
    { ...decision('d2', 's1', 2, 3), name: 'Which tile' },
  ],
  dependencies: [
    link('k1', 'a1', 'a3', 2),
    link('k2', onStage('s1'), onStage('s2')),
    link('k3', 'a4', 'a5', 1),
    link('k4', 'a5', 'gone'),
    link('k5', onStage('s2'), onStage('s3')),
    link('k6', onStage('gone'), onStage('s3')),
  ],
});

describe('exportTemplate', () => {
  it('strips the numbers: ranges from a template only, no lead, no lag, no amount', () => {
    expect(exportTemplate(WORK, options())).toEqual({
      ridgebeamTemplate: 1,
      id: 'my-bathroom',
      version: 1,
      title: { en: 'My bathroom' },
      rooms: [
        { key: 'bathroom', name: { en: 'Bathroom' } },
        { key: 'hall', name: { en: 'Hall' } },
      ],
      stages: [
        {
          key: 'strip-out',
          name: { en: 'Strip-out' },
          checks: { start: [{ en: 'Is the water off?' }, { en: 'Is the power off?' }] },
          costLines: [
            { label: { en: 'Skip hire' } },
            { label: { en: 'Labour' }, activity: 'remove-tiles' },
          ],
          decisions: [
            { key: 'which-tile', name: { en: 'Which tile' } },
            { key: 'which-tile-2', name: { en: 'Which tile' } },
          ],
          activities: [
            {
              key: 'remove-tiles',
              name: { en: 'Remove tiles' },
              durationDays: { min: 1, max: 3 },
              rooms: ['bathroom', 'hall'],
            },
            {
              key: 'remove-tiles-2',
              name: { en: 'Remove tiles' },
              durationDays: { min: 1, max: 3 },
            },
            { key: 'haul', name: { en: 'Haul' }, durationDays: { min: 2, max: 4 } },
          ],
        },
        {
          key: 'finishes',
          name: { en: 'Finishes' },
          checks: { close: [{ en: 'Is the floor clean?' }, { en: 'Is the grout sealed?' }] },
          costLines: [{ label: { en: 'Tiles' }, activity: 'lay-tiles' }],
          activities: [
            { key: 'lay-tiles', name: { en: 'Lay tiles' } },
            { key: 'grout', name: { en: 'Grout' } },
          ],
        },
        { key: 'finishes-2', name: { en: 'Finishes' } },
      ],
      links: [
        { blocker: 'strip-out/remove-tiles', blocked: 'strip-out/haul' },
        { blocker: 'strip-out', blocked: 'finishes' },
        { blocker: 'finishes/lay-tiles', blocked: 'finishes/grout' },
        { blocker: 'finishes', blocked: 'finishes-2' },
      ],
    });
  });

  it('keeps the numbers: the durations and leads picked as points, a range where none was picked, lags and the priced amounts', () => {
    const kept = exportTemplate(WORK, options({ numbers: 'keep', version: 4 }));
    expect(kept.version).toBe(4);
    const [strip, finishes] = kept.stages;
    expect(strip!.activities!.map((each) => each.durationDays)).toEqual([
      { min: 2, max: 2 },
      { min: 5, max: 5 },
      { min: 2, max: 4 },
    ]);
    expect(finishes!.activities!.map((each) => each.durationDays)).toEqual([
      { min: 4, max: 4 },
      undefined,
    ]);
    expect(strip!.decisions!.map((each) => each.leadDays)).toEqual([
      { min: 12, max: 12 },
      { min: 3, max: 3 },
    ]);
    expect(strip!.costLines).toEqual([
      { label: { en: 'Skip hire' }, amountCents: 450_00 },
      { label: { en: 'Labour' }, activity: 'remove-tiles' },
    ]);
    expect(finishes!.costLines).toEqual([
      { label: { en: 'Tiles' }, activity: 'lay-tiles', amountCents: 0 },
    ]);
    expect(kept.links!.map((each) => each.lagDays)).toEqual([2, 0, 1, 0]);
  });

  it('validates as a file, by construction, whichever the choice', () => {
    for (const numbers of ['strip', 'keep'] as const) {
      expect(
        validateTemplate(exportTemplate(WORK, options({ numbers })), 'file', NONE),
      ).toMatchObject({ ok: true });
    }
    // An empty work exports as a template with no stage, which nothing can start from: validation
    // says so, and the interface offers no export for a plan with no stage.
    const empty = exportTemplate(snapshot(), options());
    expect(empty).toEqual({
      ridgebeamTemplate: 1,
      id: 'my-bathroom',
      version: 1,
      title: { en: 'My bathroom' },
      stages: [],
    });
    expect(validateTemplate(empty, 'file', NONE)).toMatchObject({
      ok: false,
      problems: [{ path: '$.stages', key: 'template.problem.empty' }],
    });
  });

  it('writes text in the language of the work only', () => {
    const portuguese = exportTemplate(WORK, options({ language: 'pt-BR', title: 'Meu banheiro' }));
    expect(portuguese.title).toEqual({ 'pt-BR': 'Meu banheiro' });
    expect(portuguese.stages[0]!.name).toEqual({ 'pt-BR': 'Strip-out' });
  });

  it('makes an id and a title it can stand behind', () => {
    const odd = exportTemplate(
      WORK,
      options({ id: 'Reforma do Banheiro — 2º andar', title: '   ', version: 0 }),
    );
    expect(odd.id).toBe('reforma-do-banheiro-2o-andar');
    expect(odd.title).toEqual({ en: 'Sample work' });
    expect(odd.version).toBe(1);
    expect(exportTemplate(WORK, options({ version: 2.5 })).version).toBe(1);
    expect(exportTemplate(WORK, options({ version: 1_000_001 })).version).toBe(1);
    expect(exportTemplate(WORK, options({ version: 1_000_000 })).version).toBe(1_000_000);
    const long = exportTemplate(WORK, options({ title: 'x'.repeat(200) }));
    expect([...long.title.en!]).toHaveLength(120);
  });

  it('keeps names within the limits and never blank', () => {
    const odd = exportTemplate(
      snapshot({
        stages: [stage('s', 1, 'y'.repeat(130))],
        activities: [{ ...activity('a', 's', 1, 3650), name: '   ' }],
        checks: [
          {
            id: 'c',
            stageId: 's',
            gate: 'close',
            position: 1,
            name: 'z'.repeat(250),
            needsPhoto: false,
          },
        ],
      }),
      options({ numbers: 'keep' }),
    );
    expect([...odd.stages[0]!.name.en!]).toHaveLength(120);
    expect(odd.stages[0]!.key).toHaveLength(32);
    expect(odd.stages[0]!.activities![0]).toEqual({
      key: 'activity',
      name: { en: '?' },
      durationDays: { min: 3650, max: 3650 },
    });
    expect([...odd.stages[0]!.checks!.close![0]!.en!]).toHaveLength(200);
    expect(validateTemplate(odd, 'file', NONE).ok).toBe(true);
  });

  it('leaves out numbers that are not numbers the host keeps', () => {
    const odd = exportTemplate(
      snapshot({
        stages: [stage('s', 1, 'Stage')],
        activities: [
          { ...activity('a', 's', 1, 0), durationMinDays: 3, durationMaxDays: 2 },
          { ...activity('b', 's', 2, 2.5), durationMinDays: 0, durationMaxDays: 2 },
        ],
        decisions: [
          { ...decision('d', 's', 1, -1) },
          { ...decision('e', 's', 2, 4), leadMinDays: 6, leadMaxDays: 5 },
        ],
        costLines: [{ id: 'l', stageId: 's', activityId: null, label: 'Odd', amountCents: 1.5 }],
        dependencies: [link('k', 'a', 'b', -2)],
      }),
      options({ numbers: 'keep' }),
    );
    expect(odd.stages[0]!.activities!.map((each) => each.durationDays)).toEqual([
      undefined,
      undefined,
    ]);
    expect(odd.stages[0]!.decisions!.map((each) => each.leadDays)).toEqual([
      undefined,
      { min: 4, max: 4 },
    ]);
    expect(odd.stages[0]!.costLines).toEqual([{ label: { en: 'Odd' } }]);
    expect(odd.links).toEqual([{ blocker: 'stage/activity-a', blocked: 'stage/activity-b' }]);
    expect(validateTemplate(odd, 'file', NONE).ok).toBe(true);
  });
});

describe('the id of an exported template', () => {
  it("is made from the work's name when none is given, and is never longer than an id", () => {
    const { id: _id, ...unnamed } = options();
    expect(exportTemplate(WORK, unnamed).id).toBe('sample-work');
    expect(exportTemplate(WORK, options({ id: '  ' })).id).toBe('sample-work');
    const long = {
      ...WORK,
      work: { ...WORK.work, name: 'Reforma completa do apartamento do terceiro andar' },
    };
    expect(exportTemplate(long, unnamed).id).toBe('reforma-completa-do-apartamento');
    expect(exportTemplate(long, unnamed).id.length).toBeLessThanOrEqual(31);
  });

  it('falls back to my-work when nothing of the name is left', () => {
    const { id: _id, ...unnamed } = options();
    const foreign = { ...WORK, work: { ...WORK.work, name: '改修' } };
    expect(exportTemplate(foreign, unnamed).id).toBe('my-work');
  });
});

describe('keyFrom', () => {
  it.each([
    ['Bathroom renovation', 'bathroom-renovation'],
    ['  Reforma — Cozinha & Área  ', 'reforma-cozinha-area'],
    ['Instalação elétrica', 'instalacao-eletrica'],
    ['Room 2', 'room-2'],
    ['', 'template'],
    ['!!!', 'template'],
    ['数字', 'template'],
  ])('%j → %s', (text, key) => {
    expect(keyFrom(text)).toBe(key);
  });

  it('never ends on a hyphen when it cuts, and keeps a fallback of its own', () => {
    expect(keyFrom(`${'a'.repeat(31)} b`)).toBe('a'.repeat(31));
    expect(keyFrom('', 'stage')).toBe('stage');
    expect(keyFrom(`${'b'.repeat(30)} c`, 'x', 31)).toBe('b'.repeat(30));
  });
});

describe('templateText', () => {
  it('is two-space JSON with a final newline, and reads back as the template', () => {
    const text = templateText(sampleTemplate());
    expect(text.endsWith('}\n')).toBe(true);
    expect(text).toContain('\n  "id": "sample-bathroom",');
    expect(JSON.parse(text)).toEqual(sampleTemplate());
  });
});

describe('export → validate → apply → export', () => {
  /** Export, write, read, validate as a file, apply to an empty work, and export that work again. */
  function roundTrip(work: WorkSnapshot, numbers: 'strip' | 'keep') {
    const first = exportTemplate(work, options({ numbers }));
    const read = JSON.parse(templateText(first)) as unknown;
    const validated = validateTemplate(read, 'file', NONE);
    if (!validated.ok) throw new Error(JSON.stringify(validated.problems));
    const applied = applyTemplate(validated.template, NONE, 'en');
    const again = snapshotFromDraft(applied.draft);
    return { first, second: exportTemplate(again, options({ numbers })), again, applied };
  }

  it.each(['strip', 'keep'] as const)('is stable with the numbers %s', (numbers) => {
    const { first, second } = roundTrip(WORK, numbers);
    expect(second).toEqual(first);
  });

  it('is stable from a library template, both ways', () => {
    const started = snapshotFromDraft(applyTemplate(sampleTemplate(), libraryOf(), 'en').draft);
    for (const numbers of ['strip', 'keep'] as const) {
      const { first, second } = roundTrip(started, numbers);
      expect(second).toEqual(first);
    }
  });

  it("brings a kept work's amounts and durations into the next one", () => {
    const { again, applied } = roundTrip(WORK, 'keep');
    expect(again.stages).toHaveLength(3);
    expect(again.activities).toHaveLength(5);
    expect(again.costLines.map((line) => line.amountCents)).toEqual([450_00, null, 0]);
    // Every duration picked came back as that duration, and the apply summary says so.
    expect(again.activities.find((each) => each.name === 'Lay tiles')!.durationDays).toBe(4);
    expect(applied.notes).toEqual([{ key: 'template.note.pointDurations', params: { count: 3 } }]);
  });

  it("brings nothing of a stripped work's numbers", () => {
    const { again } = roundTrip(WORK, 'strip');
    expect(again.costLines.every((line) => line.amountCents === null)).toBe(true);
    expect(again.activities.every((each) => each.durationDays === null)).toBe(true);
    expect(again.decisions.every((each) => each.leadTimeDays === 0)).toBe(true);
    expect(again.dependencies.every((each) => each.lagDays === 0)).toBe(true);
  });
});

describe('learned from this work', () => {
  // The work starts on Tuesday 1 September 2026, Monday to Friday: 1–4, 7–11, 14–18 are working
  // days.
  const TODAY = '2026-09-21';
  const ranged = (base: Activity, min: number, max: number): Activity => ({
    ...base,
    durationMinDays: min,
    durationMaxDays: max,
  });
  const named = (base: Activity, name: string): Activity => ({ ...base, name });

  const JOINERY: WorkSnapshot = snapshot({
    stages: [stage('s1', 1, 'Joinery')],
    activities: [
      // Planned 3, took 7: slower, no template range.
      named(activity('slow', 's1', 1, 3), 'Fit the cabinets'),
      // Planned 4 in 2–6, took 2: faster, inside the range, which it never narrows.
      named(ranged(activity('fast', 's1', 2, 4), 2, 6), 'Hang the doors'),
      // Planned 2 in 2–4, took 5: outside the range, which widens to hold it.
      named(ranged(activity('beyond', 's1', 3, 2), 2, 4), 'Fit the handles'),
      // Planned 3, took 1: faster, no range.
      named(activity('quick', 's1', 4, 3), 'Seal the joints'),
      // No planned duration, a range 2–3, took 4.
      named(ranged(activity('unplanned', 's1', 5, null), 2, 3), 'Trim the edges'),
      // No planned duration, no range, took 2: a point.
      named(activity('bare', 's1', 6, null), 'Sand the tops'),
      // Planned 2, took 2, no range: everything agrees, a point.
      named(activity('agreed', 's1', 7, 2), 'Oil the tops'),
      // Planned 3 in 1–5, started, not finished: as kept.
      named(ranged(activity('running', 's1', 8, 3), 1, 5), 'Fit the lights'),
      // Nothing planned, not started: as kept, nothing.
      named(activity('waiting', 's1', 9, null), 'Clean up'),
    ],
    decisions: [{ ...decision('d1', 's1', 1, 4), name: 'Which handle' }],
    costLines: [
      { id: 'l1', stageId: 's1', activityId: 'slow', label: 'Cabinets', amountCents: 900_00 },
    ],
    dependencies: [link('k1', 'slow', 'fast', 1)],
  });

  const ENTRIES: DiaryEntry[] = [
    entry(1, '2026-09-01', { done: [worked('slow'), worked('beyond'), worked('agreed')] }),
    entry(2, '2026-09-02', { done: [worked('unplanned'), finished('agreed')] }),
    entry(3, '2026-09-03', { done: [worked('bare')] }),
    entry(4, '2026-09-04', { done: [finished('quick'), finished('bare')] }),
    entry(5, '2026-09-07', { done: [finished('beyond'), finished('unplanned')] }),
    entry(6, '2026-09-09', { done: [finished('slow')] }),
    entry(7, '2026-09-10', { done: [worked('fast')] }),
    entry(8, '2026-09-11', { done: [finished('fast')] }),
    entry(9, '2026-09-14', { done: [worked('running')] }),
  ];
  const FROM = { entries: ENTRIES, today: TODAY };

  const learned = (parts: Partial<ExportOptions> = {}) =>
    exportTemplate(JOINERY, options({ numbers: 'learned', learnedFrom: FROM, ...parts }));
  const kept = (work: WorkSnapshot = JOINERY) => exportTemplate(work, options({ numbers: 'keep' }));

  it('makes a finished duration the hull of the template range, the plan and what it took', () => {
    const durations = Object.fromEntries(
      learned().stages[0]!.activities!.map((each) => [each.key, each.durationDays]),
    );
    expect(durations).toEqual({
      'fit-the-cabinets': { min: 3, max: 7 },
      'hang-the-doors': { min: 2, max: 6 },
      'fit-the-handles': { min: 2, max: 5 },
      'seal-the-joints': { min: 1, max: 3 },
      'trim-the-edges': { min: 2, max: 4 },
      'sand-the-tops': { min: 2, max: 2 },
      'oil-the-tops': { min: 2, max: 2 },
      'fit-the-lights': { min: 3, max: 3 },
      'clean-up': undefined,
    });
  });

  it('keeps everything else as keep does: leads, lags and amounts', () => {
    const template = learned();
    expect(template.links).toEqual(kept().links);
    expect(template.links).toEqual([
      { blocker: 'joinery/fit-the-cabinets', blocked: 'joinery/hang-the-doors', lagDays: 1 },
    ]);
    expect(template.stages[0]!.decisions).toEqual([
      { key: 'which-handle', name: { en: 'Which handle' }, leadDays: { min: 4, max: 4 } },
    ]);
    expect(template.stages[0]!.costLines).toEqual([
      { label: { en: 'Cabinets' }, activity: 'fit-the-cabinets', amountCents: 900_00 },
    ]);
    expect(validateTemplate(template, 'file', NONE)).toMatchObject({ ok: true });
  });

  it('is keep when there is nothing to learn from', () => {
    expect(exportTemplate(JOINERY, options({ numbers: 'learned' }))).toEqual(kept());
    expect(
      exportTemplate(
        JOINERY,
        options({ numbers: 'learned', learnedFrom: { entries: [], today: TODAY } }),
      ),
    ).toEqual(kept());
    // A calendar nothing can be counted on teaches nothing either.
    const uncounted = { ...JOINERY, calendar: { workingDays: '0000000', hoursPerDay: 8 } };
    expect(exportTemplate(uncounted, options({ numbers: 'learned', learnedFrom: FROM }))).toEqual(
      kept(uncounted),
    );
  });

  it('reads no diary for strip and keep', () => {
    expect(exportTemplate(JOINERY, options({ numbers: 'keep', learnedFrom: FROM }))).toEqual(
      kept(),
    );
    expect(exportTemplate(JOINERY, options({ learnedFrom: FROM }))).toEqual(
      exportTemplate(JOINERY, options()),
    );
  });

  it('writes a summary only when one is given, in the work language, within its limit', () => {
    expect(learned()).not.toHaveProperty('summary');
    expect(learned({ summary: '   ' })).not.toHaveProperty('summary');
    expect(learned({ summary: '  Durations learned from a sample work.  ' }).summary).toEqual({
      en: 'Durations learned from a sample work.',
    });
    expect(learned({ language: 'pt-BR', summary: 'Durações aprendidas.' }).summary).toEqual({
      'pt-BR': 'Durações aprendidas.',
    });
    const long = learned({ summary: 's'.repeat(500) });
    expect([...long.summary!.en!]).toHaveLength(400);
    expect(validateTemplate(long, 'file', NONE).ok).toBe(true);
    // Any choice may carry one.
    expect(exportTemplate(JOINERY, options({ summary: 'Shared.' })).summary).toEqual({
      en: 'Shared.',
    });
  });

  it('never says more than a template can: a duration over the limit is the limit', () => {
    const long = snapshot({
      stages: [stage('s', 1, 'Stage')],
      activities: [activity('a', 's', 1, 2)],
    });
    // Fifteen years of Mondays to Fridays: more than 3650 working days.
    const entries = [
      entry(1, '2026-09-01', { done: [worked('a')] }),
      entry(2, '2041-09-02', { done: [finished('a')] }),
    ];
    const template = exportTemplate(
      long,
      options({ numbers: 'learned', learnedFrom: { entries, today: '2041-09-03' } }),
    );
    expect(template.stages[0]!.activities![0]!.durationDays).toEqual({ min: 2, max: 3650 });
    expect(validateTemplate(template, 'file', NONE).ok).toBe(true);
  });

  it('goes through a file into the next work as ranges, and as durations where all agreed', () => {
    const first = learned({ summary: 'Learned.' });
    const read = JSON.parse(templateText(first)) as unknown;
    const validated = validateTemplate(read, 'file', NONE);
    if (!validated.ok) throw new Error(JSON.stringify(validated.problems));
    const applied = applyTemplate(validated.template, NONE, 'en');
    const again = snapshotFromDraft(applied.draft);
    const byName = (name: string) => again.activities.find((each) => each.name === name)!;

    expect(byName('Fit the cabinets')).toMatchObject({
      durationDays: null,
      durationMinDays: 3,
      durationMaxDays: 7,
    });
    expect(byName('Hang the doors')).toMatchObject({
      durationDays: null,
      durationMinDays: 2,
      durationMaxDays: 6,
    });
    expect(byName('Fit the handles')).toMatchObject({ durationMinDays: 2, durationMaxDays: 5 });
    expect(byName('Seal the joints')).toMatchObject({ durationMinDays: 1, durationMaxDays: 3 });
    expect(byName('Trim the edges')).toMatchObject({ durationMinDays: 2, durationMaxDays: 4 });
    // A point is the duration.
    expect(byName('Oil the tops')).toMatchObject({
      durationDays: 2,
      durationMinDays: 2,
      durationMaxDays: 2,
    });
    expect(byName('Sand the tops').durationDays).toBe(2);
    expect(byName('Fit the lights').durationDays).toBe(3);
    expect(byName('Clean up')).toMatchObject({
      durationDays: null,
      durationMinDays: null,
      durationMaxDays: null,
    });
    expect(applied.notes).toEqual([{ key: 'template.note.pointDurations', params: { count: 3 } }]);

    // The next work, not started yet, teaches nothing new: it exports what it was given.
    const next = exportTemplate(
      again,
      options({ numbers: 'learned', learnedFrom: { entries: [], today: TODAY } }),
    );
    expect(next.stages).toEqual(first.stages);
    expect(next.links).toEqual(first.links);
  });
});
