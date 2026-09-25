import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * No sentence is written in a component.
 *
 * Every word a person reads comes from a dictionary (SPEC §2.13, §6), so a string typed into JSX is
 * a string that will never be translated. This test parses every `.tsx` under `src/` with the
 * TypeScript compiler — a parser, not a regular expression, so a generic like
 * `useState<Destination>` is never mistaken for a tag — and fails on:
 *
 *   1. JSX text that contains a letter: `<p>Settings</p>`;
 *   2. a string literal with a letter passed to a prop a person reads — `aria-label`, `title`,
 *      `placeholder`, `label`, `alt`, `description` — directly or as a branch of `? :`, `??`,
 *      `||` or `&&`: `title={open ? 'Close' : 'Open'}`;
 *   3. the same kind of literal as a JSX child expression: `{copied ? 'Copied' : label}`.
 *
 * A literal used as data (`destination === 'viewer'`) or passed to a function (`t('nav.viewer')`)
 * is not something a person reads, and is left alone. Every violation names its file and line.
 */

/** Props whose value is read by a person, or read aloud to one. */
const READ_PROPS = new Set(['aria-label', 'title', 'placeholder', 'label', 'alt', 'description']);

/**
 * Text that is the same in every language, and why.
 *
 * - `Ridgebeam`: the product's name is never translated (ADR-001), and is shown in the title bar
 *   as itself. It is the only one.
 *
 * Language names are not here: they are autonyms, kept in `src/i18n/index.ts`, not in JSX.
 */
const ALLOWED = new Set(['Ridgebeam']);

const LETTER = /\p{L}/u;

interface Violation {
  file: string;
  line: number;
  text: string;
  why: string;
}

/** The literals an expression puts on screen, following the branches that choose one. */
function displayed(expression: ts.Expression): ts.Node[] {
  if (ts.isParenthesizedExpression(expression)) return displayed(expression.expression);
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
    return [expression];
  }
  if (ts.isTemplateExpression(expression)) return [expression];
  if (ts.isConditionalExpression(expression)) {
    return [...displayed(expression.whenTrue), ...displayed(expression.whenFalse)];
  }
  if (ts.isBinaryExpression(expression)) {
    const operator = expression.operatorToken.kind;
    if (
      operator === ts.SyntaxKind.QuestionQuestionToken ||
      operator === ts.SyntaxKind.BarBarToken
    ) {
      return [...displayed(expression.left), ...displayed(expression.right)];
    }
    if (operator === ts.SyntaxKind.AmpersandAmpersandToken) return displayed(expression.right);
  }
  return [];
}

/** The words in a literal a person would read. A template's `${...}` parts are not words. */
function wordsOf(node: ts.Node): string {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) {
    return [node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join(' ');
  }
  return '';
}

/** Scan one source file. Exported through the test only, so the scanner itself is tested. */
function scan(file: string, source: string): { violations: Violation[]; jsxTexts: number } {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const violations: Violation[] = [];
  let jsxTexts = 0;

  const report = (node: ts.Node, text: string, why: string) => {
    const { line } = tree.getLineAndCharacterOfPosition(node.getStart(tree));
    violations.push({ file, line: line + 1, text: text.trim(), why });
  };

  const checkLiterals = (expression: ts.Expression, why: string) => {
    for (const literal of displayed(expression)) {
      const words = wordsOf(literal);
      if (LETTER.test(words) && !ALLOWED.has(words.trim())) report(literal, words, why);
    }
  };

  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node)) {
      const text = node.getText(tree);
      if (text.trim() !== '') jsxTexts += 1;
      if (LETTER.test(text) && !ALLOWED.has(text.trim())) report(node, text, 'JSX text');
    } else if (ts.isJsxAttribute(node)) {
      const name = node.name.getText(tree);
      if (READ_PROPS.has(name) && node.initializer !== undefined) {
        if (ts.isStringLiteral(node.initializer)) {
          checkLiterals(node.initializer, `the ${name} prop`);
        } else if (ts.isJsxExpression(node.initializer) && node.initializer.expression) {
          checkLiterals(node.initializer.expression, `the ${name} prop`);
        }
      }
    } else if (
      ts.isJsxExpression(node) &&
      node.expression !== undefined &&
      (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))
    ) {
      checkLiterals(node.expression, 'a JSX child');
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);

  return { violations, jsxTexts };
}

const SRC = join(process.cwd(), 'src');

function components(directory: string = SRC): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      found.push(...components(path));
    } else if (entry.endsWith('.tsx') && !/\.(test|spec)\.tsx$/.test(entry)) {
      found.push(path);
    }
  }
  return found;
}

describe('the scanner', () => {
  // A literal gate that silently finds nothing is worse than none: prove it finds each kind.
  it('finds each kind of literal it exists to find, at the right line', () => {
    const { violations } = scan(
      'fixture.tsx',
      [
        'export function Fixture({ open, label }: { open: boolean; label?: string }) {',
        '  return (',
        '    <section aria-label="Main">',
        '      <p>Settings</p>',
        "      <button title={open ? 'Close' : 'Open'} />",
        "      <input placeholder={label ?? 'Search'} />",
        "      <span>{open && 'Working…'}</span>",
        '      <img alt={`Page ${1}`} />',
        '    </section>',
        '  );',
        '}',
      ].join('\n'),
    );
    expect(violations.map((v) => [v.line, v.text])).toEqual([
      [3, 'Main'],
      [4, 'Settings'],
      [5, 'Close'],
      [5, 'Open'],
      [6, 'Search'],
      [7, 'Working…'],
      [8, 'Page'],
    ]);
  });

  it('leaves alone what a person never reads, and what comes from a dictionary', () => {
    const { violations } = scan(
      'fixture.tsx',
      [
        "import { useState } from 'react';",
        "type Destination = 'viewer' | 'about';",
        'export function Fixture({ t }: { t: (key: string) => string }) {',
        "  const [destination] = useState<Destination>('viewer');",
        '  return (',
        '    <div className="flex h-full" data-destination="viewer">',
        "      {destination === 'viewer' && <p>{t('viewer.title')}</p>}",
        '      <button aria-label={t(\'shell.window.close\')} type="button">…</button>',
        '      <span>Ridgebeam</span>',
        '      <span>{42} · {"—"}</span>',
        '    </div>',
        '  );',
        '}',
      ].join('\n'),
    );
    expect(violations).toEqual([]);
  });
});

describe('no component writes a sentence of its own', () => {
  const files = components();

  it('has components to check, with text in them', () => {
    expect(files.length).toBeGreaterThan(10);
    // The rail, the title bar and every page render words; a scan that saw no JSX text at all
    // is a scan that parsed nothing, not a codebase with nothing to translate.
    const texts = files.reduce(
      (total, file) => total + scan(file, readFileSync(file, 'utf8')).jsxTexts,
      0,
    );
    expect(texts).toBeGreaterThan(0);
  });

  it('finds no literal a person would read', () => {
    const found = files.flatMap((file) => scan(file, readFileSync(file, 'utf8')).violations);
    const message = found
      .map((v) => `  ${relative(process.cwd(), v.file)}:${v.line}  ${v.why}: "${v.text}"`)
      .join('\n');
    expect(found, `Strings that belong in src/i18n/en.ts:\n${message}`).toEqual([]);
  });
});
