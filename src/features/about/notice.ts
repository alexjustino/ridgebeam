/**
 * Pull the third-party section out of NOTICE.
 *
 * The file lists components as `  Name ..... Licence`, padded with dots so the plain text lines
 * up for anyone reading it in an editor. Parsing that back is a small price for having exactly
 * one list.
 *
 * Two answers that must never be confused: a NOTICE that has the section and lists nothing in it
 * yet (`found: true`, no credits — true today, and said on screen as such), and a NOTICE with no
 * such section at all (`found: false` — the file could not be read as expected, and the screen
 * says that instead). An empty list shown for the second would be a claim nobody checked.
 */
export interface Notice {
  found: boolean;
  credits: Array<{ name: string; licence: string }>;
}

export function thirdParty(text: string): Notice {
  const marker = text.indexOf('THIRD-PARTY COMPONENTS');
  if (marker === -1) return { found: false, credits: [] };

  const credits: Array<{ name: string; licence: string }> = [];
  for (const line of text.slice(marker).split(/\r?\n/)) {
    const match = /^\s{2}(\S.*?)\s*\.{3,}\s*(.+?)\s*$/.exec(line);
    if (match === null) continue;
    const [, name, licence] = match;
    if (name !== undefined && licence !== undefined) credits.push({ name, licence });
  }
  return { found: true, credits };
}
