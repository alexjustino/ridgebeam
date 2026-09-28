import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { draftProblems, provenanceProblems, sampleTemplate } from '../__fixtures__/templates';
import { applyTemplate, TEMPLATE_NOTE_KEYS } from './apply';
import { TEMPLATE_LANGUAGES } from './format';
import { validateLibrary, type LibraryFile } from './validate';

/**
 * The library test: whether a template may enter the library (R10, CONTRIBUTING.md "The template
 * library").
 *
 * Every `templates/*.json` at the repository's root must validate as `library` (both languages,
 * ranges not points, no prices, nothing real …), carry its file's name as its id, and apply to an
 * empty work in either language with nothing the host would refuse and no text taken from the
 * other language. A failure names the file and the JSON path, so a contributor knows what to fix.
 *
 * This is the one domain test that reads files: the domain itself never does (boundary.test.ts).
 */

const LIBRARY = join(process.cwd(), 'templates');

/** Every way the `.json` files in `directory` fail the library's rules, one line each. */
function libraryFailures(directory: string): string[] {
  if (!existsSync(directory)) return [];
  const failures: string[] = [];
  const files: LibraryFile[] = [];
  for (const entry of readdirSync(directory).sort()) {
    if (!entry.endsWith('.json')) continue;
    const text = readFileSync(join(directory, entry), 'utf8');
    try {
      files.push({ name: basename(entry, '.json'), raw: JSON.parse(text) as unknown });
    } catch (error) {
      failures.push(`${entry} $: not JSON (${(error as Error).message})`);
    }
  }

  const { library, rejected } = validateLibrary(files);
  for (const { name, problems } of rejected) {
    for (const problem of problems) {
      failures.push(
        `${name}.json ${problem.path}: ${problem.key} ${JSON.stringify(problem.detail)}`,
      );
    }
  }

  for (const template of library.values()) {
    for (const language of TEMPLATE_LANGUAGES) {
      const { draft, notes, provenance } = applyTemplate(template, library, language);
      for (const problem of [...draftProblems(draft), ...provenanceProblems(provenance)]) {
        failures.push(`${template.id}.json applied in ${language}: ${problem}`);
      }
      if (notes.some((note) => note.key === TEMPLATE_NOTE_KEYS.languageFallback)) {
        failures.push(`${template.id}.json applied in ${language}: text missing in ${language}`);
      }
    }
  }
  return failures;
}

describe('the template library', () => {
  it('holds only templates that pass the library rules', () => {
    // Printed whole, so one run shows everything a contributor must fix.
    expect(libraryFailures(LIBRARY), libraryFailures(LIBRARY).join('\n')).toEqual([]);
  });

  it.each(
    existsSync(LIBRARY) ? readdirSync(LIBRARY).filter((entry) => entry.endsWith('.json')) : [],
  )('%s is named after its id', (entry) => {
    const raw = JSON.parse(readFileSync(join(LIBRARY, entry), 'utf8')) as { id?: unknown };
    expect(raw.id, `${entry}: the id must be the file's name`).toBe(basename(entry, '.json'));
  });

  describe('would catch a template that may not enter, so a green run means something', () => {
    const scratch = mkdtempSync(join(tmpdir(), 'ridgebeam-library-'));
    afterAll(() => rmSync(scratch, { recursive: true, force: true }));

    const write = (name: string, value: unknown) =>
      writeFileSync(join(scratch, name), typeof value === 'string' ? value : JSON.stringify(value));

    it('passes an empty folder, and a missing one', () => {
      expect(libraryFailures(scratch)).toEqual([]);
      expect(libraryFailures(join(scratch, 'nowhere'))).toEqual([]);
    });

    it('passes a good template', () => {
      write('sample-bathroom.json', sampleTemplate());
      write('notes.txt', 'not a template: not read');
      expect(libraryFailures(scratch)).toEqual([]);
    });

    it('names the file and the path of a point duration', () => {
      const bad = sampleTemplate({ id: 'pointed' });
      write(
        'pointed.json',
        JSON.parse(
          JSON.stringify(bad).replace(
            '"durationDays":{"min":1,"max":3}',
            '"durationDays":{"min":2,"max":2}',
          ),
        ),
      );
      const failures = libraryFailures(scratch);
      expect(failures).toEqual([
        'pointed.json $.stages[0].activities[1].durationDays: template.problem.point {"days":2}',
      ]);
      rmSync(join(scratch, 'pointed.json'));
    });

    it('names a file whose id is not its name, and one that is not JSON', () => {
      write('elsewhere.json', sampleTemplate({ id: 'not-elsewhere' }));
      write('broken.json', '{ "ridgebeamTemplate": 1,');
      const failures = libraryFailures(scratch);
      expect(failures).toHaveLength(2);
      expect(failures[0]).toMatch(/^broken\.json \$: not JSON/);
      expect(failures[1]).toBe(
        'elsewhere.json $.id: template.problem.fileName {"id":"not-elsewhere","file":"elsewhere"}',
      );
      rmSync(join(scratch, 'elsewhere.json'));
      rmSync(join(scratch, 'broken.json'));
    });

    it('names a template missing a language', () => {
      write('english-only.json', {
        ...sampleTemplate({ id: 'english-only' }),
        title: { en: 'Only' },
      });
      expect(libraryFailures(scratch)).toEqual([
        'english-only.json $.title: template.problem.languageMissing {"language":"pt-BR"}',
      ]);
      rmSync(join(scratch, 'english-only.json'));
    });
  });
});

describe("the host's checks, restated for the library test", () => {
  // The library test trusts these to say what `plan_apply` would refuse; each is proved to fire.
  const stageOf = (key: string, parts: Record<string, unknown> = {}) => ({
    key,
    name: 'Stage',
    activities: [
      {
        key: 'a',
        name: 'A',
        durationDays: null,
        durationMinDays: 1,
        durationMaxDays: 2,
        rooms: [],
      },
    ],
    checks: [],
    costLines: [],
    decisions: [],
    ...parts,
  });
  const at = (stageKey: string, activityKey: string | null = null) => ({
    kind: activityKey === null ? ('stage' as const) : ('activity' as const),
    stageKey,
    activityKey,
  });

  it('passes a sound draft', () => {
    expect(draftProblems({ rooms: [], stages: [stageOf('s')], links: [] })).toEqual([]);
  });

  it('names a draft with no stage', () => {
    expect(draftProblems({ rooms: [], stages: [], links: [] })).toEqual([
      'stages: none, so there is nothing to start',
    ]);
  });

  it('names every row the host would refuse', () => {
    const problems = draftProblems({
      rooms: [
        { key: 'r', name: ' ' },
        { key: 'r', name: 'x'.repeat(121) },
      ],
      stages: [
        stageOf(' s', {
          activities: [
            {
              key: 'a',
              name: 'A',
              durationDays: 0,
              durationMinDays: 3,
              durationMaxDays: 2,
              rooms: ['nowhere'],
            },
            {
              key: 'a',
              name: 'A',
              durationDays: null,
              durationMinDays: 1,
              durationMaxDays: null,
              rooms: [],
            },
          ],
          checks: [{ gate: 'start', name: '' }],
          costLines: [{ label: 'L', activityKey: 'b', amountCents: -1 }],
          decisions: [
            { name: 'D', leadTimeDays: 1.5, leadMinDays: 1, leadMaxDays: null, needsKey: 'b' },
          ],
        }),
        stageOf(' s'),
        stageOf('k'.repeat(65)),
      ],
      links: [
        { blocker: at('gone'), blocked: at(' s', 'zz'), lagDays: -1 },
        {
          blocker: { kind: 'stage', stageKey: ' s', activityKey: 'a' },
          blocked: at(' s'),
          lagDays: 0,
        },
        {
          blocker: { kind: 'activity', stageKey: ' s', activityKey: null },
          blocked: at(' s', 'a'),
          lagDays: 0,
        },
      ],
    });
    expect(problems).toEqual([
      'rooms: a key twice',
      'rooms[0].name: blank',
      'rooms[1].name: over 120 characters',
      'stages: a key twice',
      'stages[0].key: key " s" is not 1 to 64 characters with no space around it',
      'stages[0]: an activity key twice',
      'stages[0].activities[0].durationDays: 0 not in 1..3650',
      'stages[0].activities[0]: min above max',
      'stages[0].activities[0]: room nowhere not in the draft',
      'stages[0].activities[1]: one end of a range',
      'stages[0].checks[0].name: blank',
      'stages[0].costLines[0].amountCents: -1 not in 0..1000000000000000',
      'stages[0].costLines[0]: activity b not in the stage',
      'stages[0].decisions[0].leadTimeDays: 1.5 not in 0..3650',
      'stages[0].decisions[0]: one end of a range',
      'stages[0].decisions[0]: needs b, not in the stage',
      'stages[1].key: key " s" is not 1 to 64 characters with no space around it',
      `stages[2].key: key "${'k'.repeat(65)}" is not 1 to 64 characters with no space around it`,
      'links[0]: stage gone unknown',
      'links[0]: activity  s/zz unknown',
      'links[0].lagDays: -1 not in 0..3650',
      'links[1]: kind and activity key disagree',
      'links[2]: activity  s/null unknown',
      'links[2]: kind and activity key disagree',
    ]);
  });

  it('names a link to itself, one given twice, and a cycle', () => {
    const stages = [stageOf('s'), stageOf('t')];
    expect(
      draftProblems({
        rooms: [],
        stages,
        links: [
          { blocker: at('s'), blocked: at('s'), lagDays: 0 },
          { blocker: at('s'), blocked: at('t'), lagDays: 0 },
          { blocker: at('s'), blocked: at('t'), lagDays: 2 },
        ],
      }),
    ).toEqual(['links[0]: from something to itself', 'links[2]: already in the plan']);
    expect(
      draftProblems({
        rooms: [],
        stages,
        links: [
          { blocker: at('s', 'a'), blocked: at('t'), lagDays: 0 },
          { blocker: at('t', 'a'), blocked: at('s'), lagDays: 0 },
        ],
      }),
    ).toEqual(['links[1]: cycle t/a → s/a → t/a']);
  });

  it('names a provenance the host would refuse', () => {
    expect(
      provenanceProblems({ templateId: 'fine', templateVersion: 1, templateTitle: 'Fine' }),
    ).toEqual([]);
    expect(
      provenanceProblems({
        templateId: 'Not Kebab',
        templateVersion: 1_000_001,
        templateTitle: ' padded ',
      }),
    ).toHaveLength(3);
    expect(
      provenanceProblems({ templateId: 'k'.repeat(65), templateVersion: 0.5, templateTitle: '' }),
    ).toHaveLength(3);
    expect(
      provenanceProblems({ templateId: 'k', templateVersion: 1, templateTitle: 'x'.repeat(121) }),
    ).toHaveLength(1);
  });
});
