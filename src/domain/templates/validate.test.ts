import { describe, expect, it } from 'vitest';

import { both, libraryOf, sampleTemplate } from '../__fixtures__/templates';
import type { Template, TemplateLink, TemplateOrigin } from './format';
import {
  parseTemplate,
  realLookingText,
  TEMPLATE_PROBLEM_KEYS as K,
  validateLibrary,
  validateTemplate,
  type TemplateValidation,
} from './validate';

const NONE = new Map<string, Template>();
const REMOVE = Symbol('remove');

/** A JSON copy of a template, to break on purpose. */
function copy(template: unknown = sampleTemplate()): Record<string, unknown> {
  return JSON.parse(JSON.stringify(template)) as Record<string, unknown>;
}

/** Set (or remove) the value at a dotted path — `stages.0.activities.1.durationDays` — in place. */
function put(
  target: Record<string, unknown>,
  path: string,
  value: unknown,
): Record<string, unknown> {
  const parts = path.split('.');
  let at: Record<string, unknown> = target;
  for (const part of parts.slice(0, -1)) at = at[part] as Record<string, unknown>;
  const last = parts.at(-1)!;
  if (value === REMOVE) delete at[last];
  else at[last] = value;
  return target;
}

/** A sample template with one change. */
const changed = (path: string, value: unknown) => put(copy(), path, value);

/** Every problem as `path key`, for a test that reads like the list a person would see. */
function said(result: TemplateValidation): string[] {
  return result.ok ? [] : result.problems.map((problem) => `${problem.path} ${problem.key}`);
}

const check = (
  raw: unknown,
  origin: TemplateOrigin = 'library',
  library: ReadonlyMap<string, Template> = NONE,
) => validateTemplate(raw, origin, library);

describe('validateTemplate: a sound template', () => {
  it('passes as library and as a file, and comes back as it was', () => {
    for (const origin of ['library', 'file'] as const) {
      const result = check(copy(), origin);
      expect(result).toEqual({ ok: true, template: sampleTemplate() });
    }
  });

  it('needs none of the optional parts in a file', () => {
    const minimal = {
      ridgebeamTemplate: 1,
      id: 'bare',
      version: 3,
      title: { en: 'Bare' },
      stages: [{ key: 'only', name: { 'pt-BR': 'Única' } }],
    };
    expect(said(check(minimal, 'file'))).toEqual([]);
    // The library asks for more: a summary and both languages.
    expect(said(check(minimal, 'library'))).toEqual([
      `$.title ${K.languageMissing}`,
      `$ ${K.required}`,
      `$.stages[0].name ${K.languageMissing}`,
    ]);
  });
});

describe('validateTemplate: structure', () => {
  it.each([null, [], 'template', 7])('refuses %j at the root', (value) => {
    expect(check(value)).toEqual({
      ok: false,
      problems: [{ path: '$', key: K.type, detail: { expected: 'object' } }],
    });
  });

  it('names every required field missing, all at once', () => {
    expect(check({}, 'file')).toEqual({
      ok: false,
      problems: ['ridgebeamTemplate', 'id', 'version', 'title', 'stages'].map((field) => ({
        path: '$',
        key: K.required,
        detail: { field },
      })),
    });
  });

  it('refuses a format it does not read', () => {
    expect(check(changed('ridgebeamTemplate', 2))).toEqual({
      ok: false,
      problems: [{ path: '$.ridgebeamTemplate', key: K.format, detail: { expected: 1 } }],
    });
  });

  it.each([
    ['script', '$.script'],
    ['stages.0.onApply', '$.stages[0].onApply'],
    ['stages.0.activities.0.cost', '$.stages[0].activities[0].cost'],
    ['stages.0.activities.0.durationDays.likely', '$.stages[0].activities[0].durationDays.likely'],
    ['stages.0.activities.0.name.fr', '$.stages[0].activities[0].name.fr'],
    ['stages.0.checks.during', '$.stages[0].checks.during'],
    ['stages.0.costLines.0.currency', '$.stages[0].costLines[0].currency'],
    ['stages.0.decisions.0.madeAt', '$.stages[0].decisions[0].madeAt'],
    ['rooms.0.area', '$.rooms[0].area'],
    ['links.0.kind', '$.links[0].kind'],
    ['title.es-ES', '$.title["es-ES"]'],
  ])('refuses the unknown field %s: data, not code', (path, where) => {
    const result = check(changed(path, 'x'));
    expect(said(result)).toEqual([`${where} ${K.unknownField}`]);
    expect(result.ok ? null : result.problems[0]!.detail).toEqual({
      field: path.split('.').at(-1),
    });
  });

  it.each([
    ['id', 'Bath Room', K.key],
    ['id', 'a'.repeat(32), K.key],
    ['stages.1.key', 'a'.repeat(33), K.key],
    ['id', 'double--hyphen', K.key],
    ['id', 7, K.type],
    ['stages.0.key', 'strip_out', K.key],
    ['stages.0.activities.1.key', '-lead', K.key],
    ['stages.0.decisions.0.key', 'tile-', K.key],
  ])('refuses %s = %j as a key', (path, value, key) => {
    const where = `$.${path.replace(/\.(\d+)/g, '[$1]')}`;
    expect(said(check(changed(path, value)))).toEqual([`${where} ${key}`]);
  });

  it.each([0, -1, 1.5, '1', null, 1_000_001])('refuses the version %j', (value) => {
    expect(check(changed('version', value))).toEqual({
      ok: false,
      problems: [
        {
          path: '$.version',
          key: K.number,
          detail: { min: 1, max: 1_000_000 },
        },
      ],
    });
  });

  it.each([
    ['includes', 'bathroom', '$.includes', 'array'],
    ['rooms', {}, '$.rooms', 'array'],
    ['rooms.0', 'bathroom', '$.rooms[0]', 'object'],
    ['stages', {}, '$.stages', 'array'],
    ['stages.0', 'strip-out', '$.stages[0]', 'object'],
    ['stages.0.activities', 'x', '$.stages[0].activities', 'array'],
    ['stages.0.activities.0', 3, '$.stages[0].activities[0]', 'object'],
    ['stages.0.activities.0.rooms', 'bathroom', '$.stages[0].activities[0].rooms', 'array'],
    ['stages.0.activities.0.durationDays', 2, '$.stages[0].activities[0].durationDays', 'object'],
    ['stages.0.checks', [], '$.stages[0].checks', 'object'],
    ['stages.0.checks.start', 'x', '$.stages[0].checks.start', 'array'],
    ['stages.0.costLines', {}, '$.stages[0].costLines', 'array'],
    ['stages.0.costLines.0', 'Skip', '$.stages[0].costLines[0]', 'object'],
    ['stages.0.decisions', 1, '$.stages[0].decisions', 'array'],
    ['stages.0.decisions.0', [], '$.stages[0].decisions[0]', 'object'],
    ['links', {}, '$.links', 'array'],
    ['links.0', 'a→b', '$.links[0]', 'object'],
    ['links.0.blocker', 3, '$.links[0].blocker', 'string'],
    ['title', 'Bathroom', '$.title', 'object'],
    ['title.en', 5, '$.title.en', 'string'],
  ])('refuses %s of the wrong kind', (path, value, where, expected) => {
    expect(check(changed(path, value))).toEqual({
      ok: false,
      problems: [{ path: where, key: K.type, detail: { expected } }],
    });
  });

  it('names what an element is missing', () => {
    expect(said(check(changed('stages.1.name', REMOVE)))).toEqual([`$.stages[1] ${K.required}`]);
    expect(said(check(changed('stages.1.key', REMOVE)))).toEqual([`$.stages[1] ${K.required}`]);
    expect(said(check(changed('stages.1.activities.0.key', REMOVE)))).toEqual([
      `$.stages[1].activities[0] ${K.required}`,
    ]);
    expect(said(check(changed('rooms.0.key', REMOVE)))).toEqual([`$.rooms[0] ${K.required}`]);
    expect(said(check(changed('stages.0.activities.0.name', REMOVE)))).toEqual([
      `$.stages[0].activities[0] ${K.required}`,
    ]);
    expect(said(check(changed('stages.0.decisions.0.key', REMOVE)))).toEqual([
      `$.stages[0].decisions[0] ${K.required}`,
    ]);
    expect(said(check(changed('stages.0.costLines.0.label', REMOVE)))).toEqual([
      `$.stages[0].costLines[0] ${K.required}`,
    ]);
    expect(said(check(changed('links.0.blocked', REMOVE)))).toEqual([`$.links[0] ${K.required}`]);
    expect(said(check(changed('stages.0.activities.0.durationDays.max', REMOVE)))).toEqual([
      `$.stages[0].activities[0].durationDays ${K.required}`,
    ]);
    expect(said(check(changed('stages.0.activities.0.durationDays.min', REMOVE)))).toEqual([
      `$.stages[0].activities[0].durationDays ${K.required}`,
    ]);
  });

  it('refuses a key used twice in its scope, and only the second', () => {
    const raw = copy();
    put(raw, 'stages.1.key', 'strip-out');
    put(raw, 'rooms', [
      { key: 'bathroom', name: both('A') },
      { key: 'bathroom', name: both('B') },
    ]);
    put(raw, 'stages.0.activities.1.key', 'remove-tiles');
    put(raw, 'stages.0.decisions', [
      { key: 'tile', name: both('A'), leadDays: { min: 1, max: 2 } },
      { key: 'tile', name: both('B'), leadDays: { min: 1, max: 2 } },
    ]);
    put(raw, 'stages.0.activities.0.rooms', ['bathroom', 'bathroom']);
    put(raw, 'links', []);
    const result = check(raw);
    expect(said(result)).toEqual([
      `$.rooms[1].key ${K.duplicate}`,
      `$.stages[0].activities[0].rooms[1] ${K.duplicate}`,
      `$.stages[0].activities[1].key ${K.duplicate}`,
      `$.stages[0].decisions[1].key ${K.duplicate}`,
      `$.stages[1].key ${K.duplicate}`,
    ]);
    expect(result.ok ? null : result.problems[0]!.detail).toEqual({ key: 'bathroom' });
  });

  it('lets an activity and a decision share a key, and two stages their activity keys', () => {
    // `tile` is a decision of strip-out and an activity of finishes already; add a strip-out activity.
    const raw = copy();
    put(raw, 'stages.1.activities.1.key', 'remove-tiles');
    put(raw, 'links.1.blocked', 'finishes/remove-tiles');
    expect(said(check(raw))).toEqual([]);
  });
});

describe('validateTemplate: text', () => {
  it('refuses a text with no language, or a blank one', () => {
    expect(said(check(changed('title', {}), 'file'))).toEqual([`$.title ${K.textEmpty}`]);
    expect(said(check(changed('title', { en: '   ' }), 'file'))).toEqual([
      `$.title.en ${K.textEmpty}`,
    ]);
    expect(said(check(changed('title', { en: 'Fine', 'pt-BR': '' }), 'file'))).toEqual([
      `$.title["pt-BR"] ${K.textEmpty}`,
    ]);
  });

  it('lets a file carry one language, and asks the library for both', () => {
    const raw = changed('stages.0.checks.start.0', { 'pt-BR': 'A água está fechada?' });
    expect(said(check(raw, 'file'))).toEqual([]);
    expect(check(raw, 'library')).toEqual({
      ok: false,
      problems: [
        { path: '$.stages[0].checks.start[0]', key: K.languageMissing, detail: { language: 'en' } },
      ],
    });
  });

  it('holds each text to the host limit, counted in characters, trimmed', () => {
    const at = (limit: number) => '€'.repeat(limit);
    const cases: Array<[string, number]> = [
      ['title', 120],
      ['summary', 400],
      ['rooms.0.name', 120],
      ['stages.0.name', 120],
      ['stages.0.activities.0.name', 120],
      ['stages.0.decisions.0.name', 120],
      ['stages.0.checks.close.0', 200],
      ['stages.0.costLines.0.label', 120],
    ];
    for (const [path, limit] of cases) {
      expect(said(check(changed(path, { en: at(limit), 'pt-BR': `  ${at(limit)}  ` })))).toEqual(
        [],
      );
      const result = check(changed(path, { en: at(limit + 1), 'pt-BR': 'ok' }));
      expect(result.ok ? null : result.problems).toEqual([
        {
          path: `$.${path.replace(/\.(\d+)/g, '[$1]')}.en`,
          key: K.textTooLong,
          detail: { limit },
        },
      ]);
    }
  });

  it('asks the library for a summary, and a file not', () => {
    const raw = changed('summary', REMOVE);
    expect(said(check(raw, 'library'))).toEqual([`$ ${K.required}`]);
    expect(check(raw, 'library')).toMatchObject({ problems: [{ detail: { field: 'summary' } }] });
    expect(said(check(raw, 'file'))).toEqual([]);
  });

  it.each([
    ['Ask https://example.test for a quote', 'url'],
    ['See www.sample', 'url'],
    ['Buy it at sample-store.com', 'url'],
    ['Write to someone@sample.test', 'email'],
    ['Call 555 0100 123', 'phone'],
    ['Call (11) 91234-5678', 'phone'],
    ['Call +44 20 7946 0000', 'phone'],
  ])('refuses in the library a text that looks real: %s', (text, kind) => {
    expect(realLookingText(text)).toBe(kind);
    const result = check(changed('stages.0.name.en', text), 'library');
    expect(result.ok ? null : result.problems).toEqual([
      { path: '$.stages[0].name.en', key: K.contact, detail: { kind } },
    ]);
    // A file is somebody's own: its text is theirs.
    expect(said(check(changed('stages.0.name.en', text), 'file'))).toEqual([]);
  });

  it.each([
    'Lay tiles 1–2 days after the screed',
    'Is the 220 V circuit off?',
    'Tiles of 60 × 60 cm, 2 boxes',
    'NBR 5410 inspection',
    'Pressure test at 6 bar for 24 h',
  ])('lets through ordinary numbers in a text: %s', (text) => {
    expect(realLookingText(text)).toBeNull();
  });
});

describe('validateTemplate: ranges', () => {
  const duration = 'stages.0.activities.0.durationDays';
  const lead = 'stages.0.decisions.0.leadDays';

  it('refuses a point in the library: a template carries ranges, not promises', () => {
    const result = check(changed(duration, { min: 2, max: 2 }), 'library');
    expect(result).toEqual({
      ok: false,
      problems: [
        { path: `$.stages[0].activities[0].durationDays`, key: K.point, detail: { days: 2 } },
      ],
    });
    expect(said(check(changed(lead, { min: 7, max: 7 }), 'library'))).toEqual([
      `$.stages[0].decisions[0].leadDays ${K.point}`,
    ]);
  });

  it('lets a file carry a point', () => {
    expect(said(check(changed(duration, { min: 2, max: 2 }), 'file'))).toEqual([]);
    expect(said(check(changed(lead, { min: 0, max: 0 }), 'file'))).toEqual([]);
  });

  it('refuses a range the wrong way round, in either origin', () => {
    for (const origin of ['library', 'file'] as const) {
      expect(check(changed(duration, { min: 5, max: 3 }), origin)).toEqual({
        ok: false,
        problems: [
          {
            path: '$.stages[0].activities[0].durationDays',
            key: K.rangeOrder,
            detail: { min: 5, max: 3 },
          },
        ],
      });
    }
  });

  it.each([
    [duration, { min: 0, max: 2 }, 'min', 1, 3650],
    [duration, { min: 1, max: 3651 }, 'max', 1, 3650],
    [duration, { min: 1.5, max: 2 }, 'min', 1, 3650],
    [duration, { min: '1', max: 2 }, 'min', 1, 3650],
    [lead, { min: -1, max: 2 }, 'min', 0, 3650],
    [lead, { min: 0, max: 3651 }, 'max', 0, 3650],
  ])('refuses %s = %j outside whole days', (path, value, end, min, max) => {
    const where = `$.${path.replace(/\.(\d+)/g, '[$1]')}.${end}`;
    expect(check(changed(path, value))).toEqual({
      ok: false,
      problems: [{ path: where, key: K.number, detail: { min, max } }],
    });
  });

  it('accepts a lead range from 0 and the ends of every bound', () => {
    const raw = copy();
    put(raw, lead, { min: 0, max: 3650 });
    put(raw, duration, { min: 1, max: 3650 });
    put(raw, 'links.1.lagDays', 3650);
    expect(said(check(raw))).toEqual([]);
  });

  it('asks the library for every duration and lead time, and a file not', () => {
    const raw = copy();
    put(raw, duration, REMOVE);
    put(raw, lead, REMOVE);
    const result = check(raw, 'library');
    expect(result.ok ? null : result.problems).toEqual([
      {
        path: '$.stages[0].activities[0]',
        key: K.rangeRequired,
        detail: { field: 'durationDays' },
      },
      { path: '$.stages[0].decisions[0]', key: K.rangeRequired, detail: { field: 'leadDays' } },
    ]);
    expect(said(check(raw, 'file'))).toEqual([]);
  });

  it.each([-1, 0.5, 3651, '0'])('refuses the lag %j', (value) => {
    expect(check(changed('links.0.lagDays', value))).toEqual({
      ok: false,
      problems: [{ path: '$.links[0].lagDays', key: K.number, detail: { min: 0, max: 3650 } }],
    });
  });
});

describe('validateTemplate: money', () => {
  const amount = 'stages.0.costLines.0.amountCents';

  it('refuses a price in the library, even zero: cost lines are labels', () => {
    for (const value of [12_345, 0]) {
      expect(check(changed(amount, value), 'library')).toEqual({
        ok: false,
        problems: [{ path: '$.stages[0].costLines[0].amountCents', key: K.price, detail: {} }],
      });
    }
  });

  it("lets a file keep its work's own amounts, in whole cents", () => {
    expect(said(check(changed(amount, 12_345), 'file'))).toEqual([]);
    expect(said(check(changed(amount, 0), 'file'))).toEqual([]);
    for (const value of [-1, 1.5, '100', 1_000_000_000_000_001]) {
      expect(check(changed(amount, value), 'file')).toEqual({
        ok: false,
        problems: [
          {
            path: '$.stages[0].costLines[0].amountCents',
            key: K.number,
            detail: { min: 0, max: 1_000_000_000_000_000 },
          },
        ],
      });
    }
  });
});

describe('validateTemplate: keys that must resolve', () => {
  it('refuses a room, an activity or a need that names nothing', () => {
    const raw = copy();
    put(raw, 'stages.0.activities.0.rooms', ['kitchen']);
    put(raw, 'stages.0.costLines.1.activity', 'lay-tiles');
    put(raw, 'stages.0.decisions.0.needs', 'grout');
    expect(check(raw)).toEqual({
      ok: false,
      problems: [
        {
          path: '$.stages[0].activities[0].rooms[0]',
          key: K.unknownRoom,
          detail: { key: 'kitchen' },
        },
        {
          path: '$.stages[0].costLines[1].activity',
          key: K.unknownActivity,
          detail: { key: 'lay-tiles' },
        },
        {
          path: '$.stages[0].decisions[0].needs',
          key: K.unknownActivity,
          detail: { key: 'grout' },
        },
      ],
    });
  });

  it('refuses a room key that is not a key, and only that: what names it is not judged', () => {
    expect(said(check(changed('rooms.0.key', 'Bathroom')))).toEqual([`$.rooms[0].key ${K.key}`]);
    expect(said(check(changed('stages.0.activities', 'x')))).toEqual([
      `$.stages[0].activities ${K.type}`,
    ]);
  });

  it('refuses a key that is not a key where a reference is', () => {
    expect(said(check(changed('stages.0.decisions.0.needs', 'Remove Tiles')))).toEqual([
      `$.stages[0].decisions[0].needs ${K.key}`,
    ]);
    expect(said(check(changed('stages.0.activities.0.rooms.0', 3)))).toEqual([
      `$.stages[0].activities[0].rooms[0] ${K.type}`,
    ]);
  });

  it.each([
    ['Strip out', K.endpoint, { value: 'Strip out' }],
    ['strip-out/', K.endpoint, { value: 'strip-out/' }],
    ['a/b/c', K.endpoint, { value: 'a/b/c' }],
    ['plumbing', K.unknownStage, { key: 'plumbing' }],
    ['finishes/paint', K.unknownActivity, { key: 'finishes/paint' }],
    ['other-template:finishes', K.unknownInclude, { id: 'other-template' }],
    ['bare/anything', K.unknownActivity, { key: 'bare/anything' }],
  ])('refuses the endpoint %s', (value, key, detail) => {
    // A stage with no activities: a link may name it, and no activity of it.
    const raw = changed('stages.2', { key: 'bare', name: both('Bare') });
    expect(check(put(raw, 'links.0.blocked', value))).toEqual({
      ok: false,
      problems: [{ path: '$.links[0].blocked', key, detail }],
    });
  });

  it('lets a link name its own stages through its own id', () => {
    expect(said(check(changed('links.0.blocked', 'sample-bathroom:finishes/grout')))).toEqual([]);
  });
});

describe('validateTemplate: cycles', () => {
  it('refuses a link cycle across stages, naming the loop', () => {
    const raw = changed('links.2', { blocker: 'finishes/grout', blocked: 'strip-out/haul' });
    expect(check(raw)).toEqual({
      ok: false,
      problems: [
        {
          path: '$.links[2]',
          key: K.cycle,
          detail: { chain: 'finishes/grout → strip-out/haul → finishes/grout' },
        },
      ],
    });
  });

  it('refuses a link from something to itself, as the host does', () => {
    for (const end of ['strip-out', 'finishes/grout']) {
      expect(check(changed('links.2', { blocker: end, blocked: end }))).toEqual({
        ok: false,
        problems: [{ path: '$.links[2]', key: K.selfLink, detail: {} }],
      });
    }
    // An empty stage waits on itself too, though it would expand to nothing.
    const raw = changed('stages.2', { key: 'empty', name: both('Empty') });
    put(raw, 'links.2', { blocker: 'empty', blocked: 'empty' });
    expect(said(check(raw))).toEqual([`$.links[2] ${K.selfLink}`]);
  });

  it('refuses the same link twice, as the host does, even with another lag', () => {
    expect(
      check(
        changed('links.2', { blocker: 'finishes/tile', blocked: 'finishes/grout', lagDays: 4 }),
      ),
    ).toEqual({ ok: false, problems: [{ path: '$.links[2]', key: K.duplicateLink, detail: {} }] });
    // The same pair, written once through the include and once again: the second is refused.
    const inner = sampleTemplate({ id: 'inner' });
    const outer = sampleTemplate({
      id: 'outer',
      includes: ['inner'],
      stages: [],
      links: [{ blocker: 'strip-out', blocked: 'inner:finishes' }],
    });
    expect(said(check(copy(outer), 'library', libraryOf(inner)))).toEqual([
      `$.links[0] ${K.duplicateLink}`,
    ]);
  });

  it('refuses an activity made to wait on its own stage: it waits on itself', () => {
    const raw = changed('links.2', { blocker: 'strip-out', blocked: 'strip-out/haul' });
    expect(check(raw)).toMatchObject({
      ok: false,
      problems: [
        { path: '$.links[2]', key: K.cycle, detail: { chain: 'strip-out/haul → strip-out/haul' } },
      ],
    });
  });

  it('refuses a template that includes itself', () => {
    const raw = changed('includes', ['sample-bathroom']);
    expect(check(raw, 'library', libraryOf(sampleTemplate()))).toEqual({
      ok: false,
      problems: [{ path: '$.includes[0]', key: K.selfInclude, detail: { id: 'sample-bathroom' } }],
    });
  });

  it('refuses an include cycle of two', () => {
    const a = sampleTemplate({ id: 'a', includes: ['b'] });
    const b = sampleTemplate({ id: 'b', includes: ['a'] });
    expect(check(copy(a), 'library', libraryOf(a, b))).toEqual({
      ok: false,
      problems: [{ path: '$.includes[0]', key: K.includeCycle, detail: { chain: 'a → b → a' } }],
    });
  });

  it('refuses an include cycle further down, not through the template itself', () => {
    const top = sampleTemplate({ id: 'top', includes: ['plain', 'b'] });
    const plain = sampleTemplate({ id: 'plain', stages: [], links: [] });
    const b = sampleTemplate({ id: 'b', includes: ['c'], stages: [], links: [] });
    const c = sampleTemplate({ id: 'c', includes: ['b'], stages: [], links: [] });
    expect(check(copy(top), 'library', libraryOf(plain, b, c))).toEqual({
      ok: false,
      problems: [{ path: '$.includes[1]', key: K.includeCycle, detail: { chain: 'b → c → b' } }],
    });
  });

  it('refuses an include the library does not have, and one named twice', () => {
    const raw = changed('includes', ['missing', 'missing']);
    expect(said(check(raw))).toEqual([`$.includes[1] ${K.duplicate}`]);
    expect(check(changed('includes', ['missing']))).toEqual({
      ok: false,
      problems: [{ path: '$.includes[0]', key: K.unknownInclude, detail: { id: 'missing' } }],
    });
    expect(said(check(changed('includes', ['Missing'])))).toEqual([`$.includes[0] ${K.key}`]);
  });

  it('refuses a link that closes a loop with an included template', () => {
    const inner = sampleTemplate({ id: 'inner' });
    const outer = sampleTemplate({
      id: 'outer',
      includes: ['inner'],
      stages: [
        {
          key: 'prepare',
          name: both('Prepare'),
          activities: [{ key: 'protect', name: both('Protect'), durationDays: { min: 1, max: 2 } }],
        },
      ],
      links: [
        { blocker: 'prepare/protect', blocked: 'strip-out' },
        { blocker: 'finishes/grout', blocked: 'prepare' },
      ],
    });
    expect(check(copy(outer), 'library', libraryOf(inner))).toEqual({
      ok: false,
      problems: [
        {
          path: '$.links[1]',
          key: K.cycle,
          detail: {
            chain:
              'inner:finishes/grout → prepare/protect → inner:strip-out/remove-tiles → inner:finishes/grout',
          },
        },
      ],
    });
  });

  it('passes over a link an included template cannot resolve: that template is the one to fix', () => {
    const careless = sampleTemplate({
      id: 'careless',
      links: [{ blocker: 'nowhere', blocked: 'finishes' }],
    });
    const { links: _links, ...linkless } = sampleTemplate({ id: 'linkless' });
    const outer = sampleTemplate({
      id: 'outer',
      includes: ['careless', 'linkless'],
      stages: [],
      links: [],
    });
    expect(said(check(copy(outer), 'file', libraryOf(careless, linkless)))).toEqual([]);
  });

  it('points at the includes when an included template brings a loop of its own', () => {
    // A library entry is trusted to be valid; one that is not still cannot pass through an include.
    const looping = sampleTemplate({
      id: 'looping',
      links: [
        { blocker: 'strip-out', blocked: 'finishes' },
        { blocker: 'finishes', blocked: 'strip-out' },
      ],
    });
    const outer = sampleTemplate({ id: 'outer', includes: ['looping'], stages: [], links: [] });
    expect(said(check(copy(outer), 'file', libraryOf(looping)))).toEqual([`$.includes ${K.cycle}`]);
  });

  it('refuses a template that brings no stage: there is no plan to start', () => {
    const empty = { ...copy(), stages: [], links: [] };
    expect(said(check(empty, 'library'))).toEqual([`$.stages ${K.empty}`]);
    expect(said(check(empty, 'file'))).toEqual([`$.stages ${K.empty}`]);
    // Stages brought by an include are stages.
    const composite = { ...empty, includes: ['inner'] };
    expect(said(check(composite, 'library', libraryOf(sampleTemplate({ id: 'inner' }))))).toEqual(
      [],
    );
  });
});

describe('validateTemplate: included stages named by key', () => {
  const kitchen = sampleTemplate({
    id: 'kitchen',
    stages: [
      {
        key: 'strip-out',
        name: both('Kitchen strip-out'),
        activities: [
          { key: 'units', name: both('Remove units'), durationDays: { min: 1, max: 2 } },
        ],
      },
      {
        key: 'kitchen-fit',
        name: both('Fit'),
        activities: [{ key: 'fit', name: both('Fit units'), durationDays: { min: 2, max: 4 } }],
      },
    ],
    links: [],
  });
  const bathroom = sampleTemplate({ id: 'bathroom' });
  const flat = (links: readonly TemplateLink[]) =>
    copy(
      sampleTemplate({
        id: 'flat',
        includes: ['bathroom', 'kitchen'],
        stages: [
          {
            key: 'handover',
            name: both('Handover'),
            activities: [{ key: 'clean', name: both('Clean'), durationDays: { min: 1, max: 2 } }],
          },
        ],
        links,
      }),
    );
  const library = libraryOf(bathroom, kitchen);

  it('finds the one included stage with the key', () => {
    expect(
      said(check(flat([{ blocker: 'finishes', blocked: 'handover' }]), 'library', library)),
    ).toEqual([]);
    expect(
      said(check(flat([{ blocker: 'kitchen-fit/fit', blocked: 'handover' }]), 'library', library)),
    ).toEqual([]);
  });

  it('refuses a key two included templates share, and takes the qualified name', () => {
    expect(
      check(flat([{ blocker: 'strip-out', blocked: 'handover' }]), 'library', library),
    ).toEqual({
      ok: false,
      problems: [
        { path: '$.links[0].blocker', key: K.ambiguousStage, detail: { key: 'strip-out' } },
      ],
    });
    expect(
      said(
        check(
          flat([{ blocker: 'kitchen:strip-out/units', blocked: 'handover' }]),
          'library',
          library,
        ),
      ),
    ).toEqual([]);
    expect(
      said(
        check(flat([{ blocker: 'bathroom:strip-out', blocked: 'handover' }]), 'library', library),
      ),
    ).toEqual([]);
    expect(
      said(check(flat([{ blocker: 'kitchen:finishes', blocked: 'handover' }]), 'library', library)),
    ).toEqual([`$.links[0].blocker ${K.unknownStage}`]);
  });
});

describe('parseTemplate', () => {
  it('reads a file text and validates it', () => {
    expect(parseTemplate(JSON.stringify(sampleTemplate()), 'file', NONE)).toEqual({
      ok: true,
      template: sampleTemplate(),
    });
  });

  it('says a text that is not JSON is not JSON, and never throws', () => {
    expect(parseTemplate('{ "ridgebeamTemplate": 1,', 'file', NONE)).toEqual({
      ok: false,
      problems: [{ path: '$', key: K.json, detail: {} }],
    });
    expect(parseTemplate('', 'file', NONE)).toMatchObject({ ok: false });
  });

  it('refuses a prototype-shaped field like any other unknown field', () => {
    const text = JSON.stringify(sampleTemplate()).replace('{', '{"__proto__":{"x":1},');
    expect(said(parseTemplate(text, 'file', NONE))).toEqual([`$.__proto__ ${K.unknownField}`]);
  });
});

describe('validateLibrary', () => {
  const file = (template: unknown, name = (template as Template).id) => ({ name, raw: template });

  it('keeps every template that passes, by id', () => {
    const a = sampleTemplate({ id: 'a' });
    const b = sampleTemplate({ id: 'b', includes: ['a'], stages: [], links: [] });
    const loaded = validateLibrary([file(b), file(a)]);
    expect([...loaded.library.keys()]).toEqual(['b', 'a']);
    expect(loaded.rejected).toEqual([]);
  });

  it("refuses a file whose id is not its name, and one whose include was refused, in the files' order", () => {
    const a = sampleTemplate({ id: 'a' });
    const b = sampleTemplate({ id: 'b', includes: ['a'], stages: [], links: [] });
    const c = sampleTemplate({ id: 'c', includes: ['b'], stages: [], links: [] });
    const loaded = validateLibrary([file(c), file(b), file(a, 'not-a'), file({ id: 5 }, 'junk')]);
    expect([...loaded.library.keys()]).toEqual([]);
    expect(
      loaded.rejected.map((each) => [each.name, each.problems.map((p) => `${p.path} ${p.key}`)]),
    ).toEqual([
      ['c', [`$.includes[0] ${K.unknownInclude}`]],
      ['b', [`$.includes[0] ${K.unknownInclude}`]],
      ['not-a', [`$.id ${K.fileName}`]],
      [
        'junk',
        [
          `$ ${K.required}`,
          `$ ${K.required}`,
          `$ ${K.required}`,
          `$ ${K.required}`,
          `$.id ${K.type}`,
          `$ ${K.required}`,
        ],
      ],
    ]);
    expect(loaded.rejected[2]!.problems[0]!.detail).toEqual({ id: 'a', file: 'not-a' });
  });

  it('refuses a second file with an id already taken', () => {
    const a = sampleTemplate({ id: 'a' });
    const loaded = validateLibrary([file(a), file(a)]);
    expect([...loaded.library.keys()]).toEqual(['a']);
    expect(loaded.rejected).toEqual([
      { name: 'a', problems: [{ path: '$.id', key: K.duplicate, detail: { key: 'a' } }] },
    ]);
  });

  it('refuses a file that is not a template at all', () => {
    expect(validateLibrary([{ name: 'nothing', raw: null }]).rejected).toEqual([
      { name: 'nothing', problems: [{ path: '$', key: K.type, detail: { expected: 'object' } }] },
    ]);
  });

  it('refuses a cycle among library files, both of them', () => {
    const a = sampleTemplate({ id: 'a', includes: ['b'] });
    const b = sampleTemplate({ id: 'b', includes: ['a'] });
    const loaded = validateLibrary([file(a), file(b)]);
    expect(loaded.library.size).toBe(0);
    expect(loaded.rejected.map((each) => each.problems[0]!.key)).toEqual([
      K.includeCycle,
      K.unknownInclude,
    ]);
  });
});
