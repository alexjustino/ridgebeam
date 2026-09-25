/**
 * The glossary is data; this renders it for people who read the repository.
 *
 * `src/i18n/glossary.json` holds every term the product shows, with its plain
 * sentence, in every language the product speaks (SPEC §2.13) — and, where a
 * term changes with the lens, the word each lens uses instead (ADR-014). This
 * script checks that file and writes `docs/GLOSSARY.md` from it, so the page a
 * contributor reads and the data the product uses are one fact, not two.
 *
 *   node scripts/glossary.mjs           validate, then write docs/GLOSSARY.md
 *   node scripts/glossary.mjs --check   validate, then fail if docs/GLOSSARY.md
 *                                       is not byte-for-byte what would be written
 *
 * The check is a gate (`npm run check:glossary`, run by `npm run gates`): a
 * term added to the data without regenerating the page, or a page edited by
 * hand, fails it. Validation failures stop both modes — a glossary with a
 * missing Portuguese sentence is not rendered, because a page that looks
 * complete while the data is not is the defect this exists to prevent.
 *
 * `validate` and `render` are exported so they can be exercised on fixtures;
 * the command runs only when this file is the entry point.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = 'src/i18n/glossary.json';
const TARGET = 'docs/GLOSSARY.md';

/**
 * The column headings for each language, in that language. A language the
 * data declares and this table does not know is a failure, not a guess: the
 * page would otherwise gain columns headed by a language code.
 */
const HEADINGS = {
  en: {
    name: 'English',
    term: 'English term',
    sentence: 'Sentence (en)',
    lenses: { engineer: 'Engineer (en)', architect: 'Architect (en)', owner: 'Owner (en)' },
  },
  'pt-BR': {
    name: 'Portuguese (Brazil)',
    term: 'Termo (pt-BR)',
    sentence: 'Frase (pt-BR)',
    lenses: {
      engineer: 'Engenheiro (pt-BR)',
      architect: 'Arquiteto (pt-BR)',
      owner: 'Dono (pt-BR)',
    },
  },
};

/**
 * The lenses, in the order the page shows them. The same closed list the host
 * keeps for the `lens` setting (ADR-013); a lens the data names and this list
 * does not is a failure.
 */
const LENSES = ['engineer', 'architect', 'owner'];

/** A key is camelCase: a lower-case letter, then letters and digits. */
const KEY = /^[a-z][a-zA-Z0-9]*$/;

/** A non-empty, single-line string, or the reason it is not one. */
function textProblem(value) {
  if (typeof value !== 'string' || value.trim() === '') return 'is empty';
  if (/[\r\n]/.test(value)) return 'spans more than one line';
  return null;
}

/** Every problem in the data, not just the first. */
export function validate(data) {
  const problems = [];

  const languages = data?.languages;
  if (!Array.isArray(languages) || languages.length === 0) {
    problems.push('`languages` must be a non-empty list');
    return problems;
  }
  if (new Set(languages).size !== languages.length) {
    problems.push('`languages` names a language twice');
  }
  for (const language of languages) {
    if (!(language in HEADINGS)) {
      problems.push(`language "${language}" has no column headings in scripts/glossary.mjs`);
    }
  }

  const terms = data?.terms;
  if (!Array.isArray(terms) || terms.length === 0) {
    problems.push('`terms` must be a non-empty list');
    return problems;
  }

  const seen = new Set();
  terms.forEach((entry, index) => {
    const where = `terms[${index}]`;
    const key = entry?.key;
    if (typeof key !== 'string' || key === '') {
      problems.push(`${where}: no key`);
      return;
    }
    const label = `${where} "${key}"`;
    if (!KEY.test(key)) problems.push(`${label}: the key is not camelCase`);
    if (seen.has(key)) problems.push(`${label}: the key is used twice`);
    seen.add(key);

    for (const language of languages) {
      const text = entry[language];
      if (text === undefined || text === null || typeof text !== 'object') {
        problems.push(`${label}: no ${language}`);
        continue;
      }
      for (const field of ['term', 'sentence']) {
        const problem = textProblem(text[field]);
        if (problem !== null) problems.push(`${label}: ${language}.${field} ${problem}`);
      }
      for (const field of Object.keys(text)) {
        if (!['term', 'sentence', 'lenses'].includes(field)) {
          problems.push(`${label}: ${language}.${field} is not a field a term has`);
        }
      }

      // The lenses are optional; when present, a closed set of names, each
      // with a word. The sentence never varies by lens, so there is nowhere
      // here to put one.
      if (!('lenses' in text)) continue;
      const lenses = text.lenses;
      if (lenses === null || typeof lenses !== 'object' || Array.isArray(lenses)) {
        problems.push(`${label}: ${language}.lenses must be an object of lens to term`);
        continue;
      }
      const names = Object.keys(lenses);
      if (names.length === 0) {
        problems.push(`${label}: ${language}.lenses is empty — leave it out instead`);
      }
      for (const lens of names) {
        if (!LENSES.includes(lens)) {
          problems.push(
            `${label}: ${language}.lenses.${lens} is not a lens (${LENSES.join(', ')})`,
          );
          continue;
        }
        const problem = textProblem(lenses[lens]);
        if (problem !== null) problems.push(`${label}: ${language}.lenses.${lens} ${problem}`);
      }
    }

    for (const field of Object.keys(entry)) {
      if (field !== 'key' && !languages.includes(field)) {
        problems.push(`${label}: "${field}" is not a declared language`);
      }
    }
  });

  return problems;
}

/** A table cell: a pipe would end the cell early. */
function cell(text) {
  return text.trim().replace(/\|/g, '\\|');
}

/** The word a lens shows for a term in a language: its own, or the term. */
function termFor(text, lens) {
  return text.lenses?.[lens] ?? text.term;
}

/** A term varies when, in any language, some lens shows a word other than the term. */
function varies(entry, languages) {
  return languages.some((language) =>
    LENSES.some((lens) => termFor(entry[language], lens).trim() !== entry[language].term.trim()),
  );
}

function table(header, rows) {
  return [
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...rows.map((cells) => `| ${cells.join(' | ')} |`),
  ];
}

export function render(data) {
  const { languages, terms } = data;
  const names = languages.map((language) => HEADINGS[language].name).join(' and ');

  const header = ['Key'];
  for (const language of languages) {
    header.push(HEADINGS[language].term, HEADINGS[language].sentence);
  }
  const rows = terms.map((entry) => {
    const cells = [`\`${entry.key}\``];
    for (const language of languages) {
      cells.push(cell(entry[language].term), cell(entry[language].sentence));
    }
    return cells;
  });

  const lensHeader = ['Key'];
  for (const language of languages) {
    for (const lens of LENSES) lensHeader.push(HEADINGS[language].lenses[lens]);
  }
  const varying = terms.filter((entry) => varies(entry, languages));
  const lensRows = varying.map((entry) => {
    const cells = [`\`${entry.key}\``];
    for (const language of languages) {
      for (const lens of LENSES) cells.push(cell(termFor(entry[language], lens)));
    }
    return cells;
  });

  const lines = [
    '# Glossary',
    '',
    '<!-- Generated by scripts/glossary.mjs from src/i18n/glossary.json. Do not edit by hand. -->',
    '',
    `Every term Ridgebeam shows, with the plain sentence that explains it, in ${names}.`,
    '',
    '**This page is generated.** The glossary is data, and its one source is',
    `[\`${SOURCE}\`](../${SOURCE}); the tests read it and so does this page. To change a`,
    'term, edit the JSON and run `npm run glossary`. `npm run check:glossary`, one of the gates,',
    'fails when this page and the data disagree — and, before that, when any term is missing a',
    'language, a term or a sentence, or names a lens that does not exist.',
    '',
    'A term shown on a screen that is not here is a defect (SPEC §2.13, §6).',
    '',
    `${terms.length} terms.`,
    '',
    ...table(header, rows),
    '',
    '## The lenses',
    '',
    'A lens is a vocabulary and an arrangement over the same rows (ADR-014). Where a term changes',
    'with the lens, the word each lens shows is below; a lens with no word of its own shows the term.',
    'The sentence never changes with the lens, and nothing about a work is stored per lens.',
    '',
  ];

  if (varying.length === 0) {
    lines.push('No term changes with the lens yet.', '');
  } else {
    lines.push(
      `${varying.length} of the ${terms.length} terms change with the lens.`,
      '',
      ...table(lensHeader, lensRows),
      '',
    );
  }
  return lines.join('\n');
}

/** The first lines where two texts part ways, numbered, for a failure message. */
function differences(expected, actual, limit = 10) {
  const want = expected.split('\n');
  const have = actual.split('\n');
  const out = [];
  const length = Math.max(want.length, have.length);
  for (let i = 0; i < length && out.length < limit; i++) {
    if (want[i] !== have[i]) {
      out.push(`  line ${i + 1}:`);
      out.push(
        `    expected: ${want[i] === undefined ? '(end of file)' : JSON.stringify(want[i])}`,
      );
      out.push(
        `    on disk:  ${have[i] === undefined ? '(end of file)' : JSON.stringify(have[i])}`,
      );
    }
  }
  return out;
}

function main() {
  const check = process.argv.includes('--check');

  let data;
  try {
    data = JSON.parse(readFileSync(path.join(root, SOURCE), 'utf-8'));
  } catch (error) {
    console.error(`${SOURCE} could not be read: ${error.message}`);
    return 1;
  }

  const problems = validate(data);
  if (problems.length > 0) {
    console.error(`${SOURCE} is not a complete glossary:\n`);
    for (const problem of problems) console.error(`  ${problem}`);
    return 1;
  }

  const expected = render(data);
  const target = path.join(root, TARGET);

  if (!check) {
    writeFileSync(target, expected, 'utf-8');
    console.log(`${TARGET}: ${data.terms.length} terms in ${data.languages.join(', ')}`);
    return 0;
  }

  if (!existsSync(target)) {
    console.error(`${TARGET} does not exist. Run \`npm run glossary\`.`);
    return 1;
  }

  const actual = readFileSync(target, 'utf-8');
  if (actual !== expected) {
    console.error(`${TARGET} is not what ${SOURCE} generates:\n`);
    for (const line of differences(expected, actual)) console.error(line);
    console.error('\nThe JSON is the source. Run `npm run glossary` and commit the page with it.');
    return 1;
  }

  console.log(`${TARGET} agrees with ${SOURCE}: ${data.terms.length} terms`);
  return 0;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}
