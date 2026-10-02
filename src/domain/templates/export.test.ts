import { describe, expect, it } from 'vitest';

import { activity, decision, link, onStage, snapshot, stage } from '../__fixtures__/plan';
import { libraryOf, sampleTemplate, snapshotFromDraft } from '../__fixtures__/templates';
import type { WorkSnapshot } from '../plan';
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
