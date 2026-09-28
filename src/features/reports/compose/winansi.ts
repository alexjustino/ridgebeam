/**
 * What the page can print: the characters the host's standard Helvetica faces carry in
 * WinAnsiEncoding (ADR-031), and the three it substitutes.
 *
 * The host embeds no font, so a report is written in the fourteen standard faces' WinAnsi set —
 * the printable ASCII, the Latin-1 supplement from U+00A0, and the 27 characters Windows-1252 puts
 * between 0x80 and 0x9F. That covers Portuguese and English as the product writes them — × (U+00D7)
 * included, which is Latin-1 and prints as itself. Three characters outside it are printed by the
 * host as documented stand-ins (→ "->", ≥ ">=", ≤ "<="); anything else would print as "?", and a
 * test composes every report in both languages and fails on any character that would.
 *
 * This is the interface's mirror of the host's table (`src-tauri/src/report/winansi.rs`), kept here
 * for that test and for `printable`, which folds the typographic spaces and the minus sign `Intl`
 * writes into dates and numbers onto the ones the faces have — a formatting detail, not a word.
 */

/** Windows-1252's 0x80–0x9F block, as Unicode: the only characters above U+00FF WinAnsi has. */
const WINDOWS_1252_HIGH = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';

/** The three stand-ins the host prints, and what it prints (`SUBSTITUTES` in winansi.rs). */
export const SUBSTITUTES: Readonly<Record<string, string>> = {
  '→': '->',
  '≥': '>=',
  '≤': '<=',
};

/** Whether one character (a code point) is in the WinAnsi set the host prints as itself. */
export function inWinAnsi(character: string): boolean {
  const code = character.codePointAt(0) ?? 0;
  if (code >= 0x20 && code <= 0x7e) return true;
  if (code >= 0xa0 && code <= 0xff) return true;
  return WINDOWS_1252_HIGH.includes(character);
}

/**
 * The characters of a text the page could not print as they are, each once: neither in the set nor
 * one of the three substitutes. An empty list means the page says exactly what the screen says.
 */
export function unprintable(text: string): string[] {
  const found = new Set<string>();
  for (const character of text) {
    // A line feed is not a glyph: the host breaks the line there.
    if (character === '\n') continue;
    if (!inWinAnsi(character) && !Object.hasOwn(SUBSTITUTES, character)) found.add(character);
  }
  return [...found];
}

/**
 * The spaces and the minus sign `Intl` writes, folded onto the ones the faces carry: the narrow
 * no-break space before "AM" and inside French-style groups, the thin space, the figure space,
 * U+2212 minus, the non-breaking hyphen. A line break is kept, as a line feed — the host breaks
 * the line there — and a tab is a space.
 */
export function printable(text: string): string {
  return text
    .replace(/[\u202f\u2007]/g, '\u00a0')
    .replace(/[\u2002-\u2006\u2008-\u200a]/g, ' ')
    .replace(/[\u2010\u2011\u2212]/g, '-')
    .replace(/\u200b|\u200c|\u200d|\u2060|\ufeff/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, ' ');
}
