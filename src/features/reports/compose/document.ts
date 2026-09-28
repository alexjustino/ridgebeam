/**
 * What every composed report shares: the host's limits, the one pass that makes every string
 * printable, and the splitting of a text too long for one string.
 *
 * The host refuses a document over its limits with a sentence (decision 8) — 5 000 blocks, 20 000
 * rows in its tables, figures and schedules together, 2 000 characters in any one string. The composers keep inside them by construction: a
 * note longer than a string may hold is carried on as many strings as it takes, never cut.
 */

import type { ReportBlock, ReportDocument } from '@/data/commands';

import { printable } from './winansi';

/** The host's caps (`src-tauri/src/report/model.rs`). */
export const REPORT_LIMITS = {
  blocks: 5000,
  /** Rows of every table, figure and schedule of a document, together. */
  tableRows: 20_000,
  text: 2000,
} as const;

/**
 * A text in pieces of at most `limit` characters, broken at a space where there is one near the
 * end, so no word is split that need not be. Nothing is dropped: the pieces joined with a space are
 * the text (less the spaces the breaks fell on).
 */
export function pieces(text: string, limit: number = REPORT_LIMITS.text): string[] {
  const out: string[] = [];
  let rest = text;
  while ([...rest].length > limit) {
    const characters = [...rest];
    const head = characters.slice(0, limit).join('');
    const space = head.lastIndexOf(' ');
    const cut = space > limit / 2 ? space : head.length;
    out.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  out.push(rest);
  return out;
}

/** A text shortened to `limit` characters for a row that only points at it, marked with "…". */
export function shortened(text: string, limit: number): string {
  const characters = [...text.replace(/\s+/g, ' ').trim()];
  return characters.length <= limit
    ? characters.join('')
    : `${characters
        .slice(0, limit - 1)
        .join('')
        .trimEnd()}…`;
}

/** Every string of a block, printable. */
function printableBlock(block: ReportBlock): ReportBlock {
  switch (block.type) {
    case 'heading':
      return { ...block, text: printable(block.text) };
    case 'paragraph':
      return { ...block, text: printable(block.text) };
    case 'figure':
      return {
        ...block,
        label: printable(block.label),
        value: printable(block.value),
        rows: block.rows.map(printable),
      };
    case 'table':
      return {
        ...block,
        columns: block.columns.map((column) => ({ ...column, text: printable(column.text) })),
        rows: block.rows.map((row) => row.map(printable)),
      };
    case 'gantt':
      return {
        ...block,
        dayLabels: block.dayLabels.map(printable),
        rows: block.rows.map((row) => ({ ...row, label: printable(row.label) })),
      };
    case 'rule':
    case 'pageBreak':
      return block;
  }
}

/** The document as the host is sent it: every string printable. */
export function finished(document: ReportDocument): ReportDocument {
  return {
    ...document,
    title: printable(document.title),
    subtitle: printable(document.subtitle),
    blocks: document.blocks.map(printableBlock),
  };
}

/** Every string a document holds, for the tests that read what the page will say. */
export function stringsOf(document: ReportDocument): string[] {
  const out = [document.title, document.subtitle];
  for (const block of document.blocks) {
    switch (block.type) {
      case 'heading':
      case 'paragraph':
        out.push(block.text);
        break;
      case 'figure':
        out.push(block.label, block.value, ...block.rows);
        break;
      case 'table':
        out.push(...block.columns.map((column) => column.text), ...block.rows.flat());
        break;
      case 'gantt':
        out.push(...block.dayLabels, ...block.rows.map((row) => row.label));
        break;
      default:
        break;
    }
  }
  return out;
}

/**
 * A table's rows with no cell over the string limit: a cell that is longer is carried on in rows
 * beneath it whose other cells are empty, so the table reads down as one entry.
 */
export function tableRows(rows: readonly string[][]): string[][] {
  const out: string[][] = [];
  for (const row of rows) {
    const split = row.map((cell) => pieces(cell));
    const height = Math.max(1, ...split.map((each) => each.length));
    for (let line = 0; line < height; line += 1) {
      out.push(split.map((each) => each[line] ?? ''));
    }
  }
  return out;
}
