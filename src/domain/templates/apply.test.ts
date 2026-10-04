import { describe, expect, it } from 'vitest';

import {
  both,
  draftProblems,
  libraryOf,
  sampleTemplate,
  snapshotFromDraft,
} from '../__fixtures__/templates';
import { readiness } from '../readiness';
import { schedule } from '../schedule';
import { applyTemplate, draftCounts, TEMPLATE_NOTE_KEYS } from './apply';
import type { Template } from './format';
import { validateTemplate } from './validate';

const NONE = new Map<string, Template>();

describe('applyTemplate', () => {
  const { draft, notes, provenance } = applyTemplate(sampleTemplate(), NONE, 'en');

  it('lays the template out as a draft the host accepts, saying nothing when nothing is odd', () => {
    expect(draftProblems(draft)).toEqual([]);
    expect(notes).toEqual([]);
    expect(provenance).toEqual({
      templateId: 'sample-bathroom',
      templateVersion: 1,
      templateTitle: 'Sample bathroom',
    });
    expect(draft.rooms).toEqual([{ key: 'bathroom', name: 'Bathroom' }]);
    expect(draft.stages.map((stage) => stage.key)).toEqual(['strip-out', 'finishes']);
  });

  it('never invents a duration: a range leaves the duration for a person', () => {
    expect(draft.stages[0]!.activities).toEqual([
      {
        key: 'remove-tiles',
        name: 'Remove tiles',
        durationDays: null,
        durationMinDays: 1,
        durationMaxDays: 2,
        rooms: ['bathroom'],
      },
      {
        key: 'haul',
        name: 'Haul rubble',
        durationDays: null,
        durationMinDays: 1,
        durationMaxDays: 3,
        rooms: [],
      },
    ]);
  });

  it('takes the upper end of a lead-time range, and keeps the range', () => {
    expect(draft.stages[0]!.decisions).toEqual([
      {
        name: 'Which tile',
        leadTimeDays: 15,
        leadMinDays: 5,
        leadMaxDays: 15,
        needsKey: 'remove-tiles',
      },
    ]);
  });

  it('copies checks gate by gate, cost lines as labels with no amount, and links with their lag', () => {
    expect(draft.stages[0]!.checks).toEqual([
      { gate: 'start', name: 'Is the water shut off?', needsPhoto: false },
      { gate: 'close', name: 'Is the rubble gone?', needsPhoto: false },
    ]);
    expect(draft.stages[0]!.costLines).toEqual([
      { label: 'Skip hire', activityKey: null, amountCents: null },
      { label: 'Labour', activityKey: 'remove-tiles', amountCents: null },
    ]);
    expect(draft.stages[1]!.checks).toEqual([]);
    expect(draft.stages[1]!.costLines).toEqual([]);
    expect(draft.stages[1]!.decisions).toEqual([]);
    expect(draft.links).toEqual([
      {
        blocker: { kind: 'stage', stageKey: 'strip-out', activityKey: null },
        blocked: { kind: 'stage', stageKey: 'finishes', activityKey: null },
        lagDays: 0,
      },
      {
        blocker: { kind: 'activity', stageKey: 'finishes', activityKey: 'tile' },
        blocked: { kind: 'activity', stageKey: 'finishes', activityKey: 'grout' },
        lagDays: 1,
      },
    ]);
  });

  it('is in the language chosen', () => {
    const portuguese = applyTemplate(sampleTemplate(), NONE, 'pt-BR');
    expect(portuguese.draft.stages[0]!.name).toBe('Strip-out (pt)');
    expect(portuguese.provenance.templateTitle).toBe('Sample bathroom (pt)');
    expect(portuguese.notes).toEqual([]);
  });

  it('applies a point from a file as the duration, and says how many', () => {
    const pointed = sampleTemplate({
      stages: [
        {
          key: 'only',
          name: both('Only'),
          activities: [
            { key: 'a', name: both('A'), durationDays: { min: 4, max: 4 } },
            { key: 'b', name: both('B'), durationDays: { min: 2, max: 2 } },
            { key: 'c', name: both('C'), durationDays: { min: 2, max: 3 } },
            { key: 'd', name: both('D') },
          ],
          decisions: [{ key: 'x', name: both('X') }],
        },
      ],
      links: [{ blocker: 'only/a', blocked: 'only/b' }],
    });
    expect(validateTemplate(pointed, 'library', NONE).ok).toBe(false);
    expect(validateTemplate(pointed, 'file', NONE).ok).toBe(true);

    const applied = applyTemplate(pointed, NONE, 'en');
    expect(
      applied.draft.stages[0]!.activities.map((each) => [
        each.durationDays,
        each.durationMinDays,
        each.durationMaxDays,
      ]),
    ).toEqual([
      [4, 4, 4],
      [2, 2, 2],
      [null, 2, 3],
      [null, null, null],
    ]);
    // No lead time said: nothing to wait for, and no range.
    expect(applied.draft.stages[0]!.decisions[0]).toEqual({
      name: 'X',
      leadTimeDays: 0,
      leadMinDays: null,
      leadMaxDays: null,
      needsKey: null,
    });
    // A link with no lag waits none.
    expect(applied.draft.links[0]!.lagDays).toBe(0);
    expect(applied.notes).toEqual([
      { key: TEMPLATE_NOTE_KEYS.pointDurations, params: { count: 2 } },
    ]);
  });

  it("keeps a file's amounts: they are that work's own numbers", () => {
    const priced = sampleTemplate({
      stages: [
        {
          key: 'only',
          name: both('Only'),
          costLines: [{ label: both('Tiles'), amountCents: 12_345 }],
        },
      ],
      links: [],
    });
    expect(applyTemplate(priced, NONE, 'en').draft.stages[0]!.costLines).toEqual([
      { label: 'Tiles', activityKey: null, amountCents: 12_345 },
    ]);
  });

  it('takes a text missing in the language chosen from the other, and counts them', () => {
    const english = sampleTemplate({
      title: { en: 'English title' },
      rooms: [{ key: 'bathroom', name: { 'pt-BR': 'Banheiro' } }],
      stages: [
        {
          key: 'only',
          name: { en: 'Only' },
          checks: { close: [{ en: 'Done?' }] },
          activities: [{ key: 'a', name: { en: 'A' }, rooms: ['bathroom'] }],
        },
      ],
      links: [],
    });
    const applied = applyTemplate(english, NONE, 'pt-BR');
    expect(applied.provenance.templateTitle).toBe('English title');
    expect(applied.draft.rooms).toEqual([{ key: 'bathroom', name: 'Banheiro' }]);
    expect(applied.notes).toEqual([
      { key: TEMPLATE_NOTE_KEYS.languageFallback, params: { count: 4, language: 'en' } },
    ]);
    expect(applyTemplate(english, NONE, 'en').notes).toEqual([
      { key: TEMPLATE_NOTE_KEYS.languageFallback, params: { count: 1, language: 'pt-BR' } },
    ]);
  });

  it('applies a bare template: a stage and nothing else', () => {
    const bare: Template = {
      ridgebeamTemplate: 1,
      id: 'bare',
      version: 2,
      title: { en: 'Bare' },
      stages: [{ key: 'only', name: { en: 'Only' }, checks: {} }],
    };
    expect(applyTemplate(bare, NONE, 'en')).toEqual({
      draft: {
        rooms: [],
        stages: [
          { key: 'only', name: 'Only', activities: [], checks: [], costLines: [], decisions: [] },
        ],
        links: [],
      },
      notes: [],
      provenance: { templateId: 'bare', templateVersion: 2, templateTitle: 'Bare' },
    });
  });

  it('trims the text it applies', () => {
    const padded = sampleTemplate({
      stages: [{ key: 'only', name: { en: '  Only  ' } }],
      links: [],
    });
    expect(applyTemplate(padded, NONE, 'en').draft.stages[0]!.name).toBe('Only');
  });
});

describe('applyTemplate with includes', () => {
  const room = (key: string, name: string) => ({ key, name: both(name) });
  const stageOf = (key: string, activity = 'work') => ({
    key,
    name: both(key),
    activities: [{ key: activity, name: both(activity), durationDays: { min: 1, max: 2 } }],
  });
  const base = sampleTemplate({
    id: 'base',
    title: both('Base'),
    rooms: [room('hall', 'Hall')],
    stages: [stageOf('base-stage')],
    links: [],
  });
  const bath = sampleTemplate({
    id: 'bath',
    title: both('Bath'),
    includes: ['base'],
    rooms: [room('bathroom', 'Bathroom'), room('hall', 'Corridor')],
    stages: [stageOf('strip-out'), stageOf('tiling')],
    links: [{ blocker: 'strip-out', blocked: 'tiling', lagDays: 2 }],
  });
  const kitchen = sampleTemplate({
    id: 'kitchen',
    title: both('Kitchen'),
    includes: ['base', 'bath'],
    rooms: [room('kitchen', 'Kitchen')],
    stages: [stageOf('strip-out'), stageOf('units')],
    links: [{ blocker: 'base-stage', blocked: 'units' }],
  });
  const flat = sampleTemplate({
    id: 'flat',
    title: both('Flat'),
    includes: ['bath', 'kitchen'],
    stages: [stageOf('handover', 'clean')],
    links: [
      { blocker: 'bath:strip-out/work', blocked: 'handover' },
      { blocker: 'kitchen:strip-out', blocked: 'handover/clean', lagDays: 1 },
      { blocker: 'units', blocked: 'handover' },
    ],
  });
  const library = libraryOf(base, bath, kitchen);

  it('is a valid composition', () => {
    expect(validateTemplate(flat, 'library', library)).toMatchObject({ ok: true });
  });

  const { draft, notes } = applyTemplate(flat, library, 'en');

  it('expands every include once, depth first and in order, then its own stages', () => {
    expect(draft.stages.map((stage) => stage.key)).toEqual([
      'base:base-stage',
      'bath:strip-out',
      'bath:tiling',
      'kitchen:strip-out',
      'kitchen:units',
      'handover',
    ]);
    expect(notes).toEqual([
      { key: TEMPLATE_NOTE_KEYS.includes, params: { count: 3, titles: 'Base, Bath, Kitchen' } },
    ]);
    expect(draftProblems(draft)).toEqual([]);
  });

  it('merges rooms by key, the first name given winning', () => {
    expect(draft.rooms).toEqual([
      { key: 'hall', name: 'Hall' },
      { key: 'bathroom', name: 'Bathroom' },
      { key: 'kitchen', name: 'Kitchen' },
    ]);
  });

  it("carries every template's links, each resolved where it was written", () => {
    const at = (stageKey: string, activityKey: string | null = null) => ({
      kind: activityKey === null ? 'stage' : 'activity',
      stageKey,
      activityKey,
    });
    expect(draft.links).toEqual([
      { blocker: at('bath:strip-out'), blocked: at('bath:tiling'), lagDays: 2 },
      { blocker: at('base:base-stage'), blocked: at('kitchen:units'), lagDays: 0 },
      { blocker: at('bath:strip-out', 'work'), blocked: at('handover'), lagDays: 0 },
      { blocker: at('kitchen:strip-out'), blocked: at('handover', 'clean'), lagDays: 1 },
      { blocker: at('kitchen:units'), blocked: at('handover'), lagDays: 0 },
    ]);
  });

  it('counts what the preview shows', () => {
    expect(draftCounts(draft)).toEqual({ stages: 6, activities: 6, decisions: 0, checks: 0 });
    expect(draftCounts(applyTemplate(sampleTemplate(), NONE, 'en').draft)).toEqual({
      stages: 2,
      activities: 4,
      decisions: 1,
      checks: 2,
    });
  });

  it('leaves out, rather than invents, a link it cannot resolve in a template it was not told was valid', () => {
    const unchecked = sampleTemplate({ links: [{ blocker: 'nowhere', blocked: 'finishes' }] });
    expect(applyTemplate(unchecked, NONE, 'en').draft.links).toEqual([]);
    // An include the library does not have brings nothing.
    const orphan = sampleTemplate({ includes: ['missing'] });
    expect(applyTemplate(orphan, NONE, 'en').draft.stages).toHaveLength(2);
  });
});

describe('a plan started from a template', () => {
  const plan = snapshotFromDraft(applyTemplate(sampleTemplate(), NONE, 'en').draft);
  const planned = schedule(plan);
  const measure = readiness(plan, { schedule: planned, today: '2026-09-01' });

  it('has no duration yet, and readiness says so with the range', () => {
    const durations = measure.missing.filter((row) => row.ruleId === 'activity.duration');
    expect(durations.map((row) => [row.name, row.durationRange])).toEqual([
      ['Remove tiles', { min: 1, max: 2 }],
      ['Haul rubble', { min: 1, max: 3 }],
      ['Lay tiles', { min: 3, max: 5 }],
      ['Grout', { min: 1, max: 2 }],
    ]);
    expect(planned.dates.size).toBe(0);
  });

  it('has no money planned: its cost lines are labels, so every stage is missing its money', () => {
    expect(
      measure.missing.filter((row) => row.ruleId === 'stage.money').map((row) => row.name),
    ).toEqual(['Strip-out', 'Finishes']);
  });
});
