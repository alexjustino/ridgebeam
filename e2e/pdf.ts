import { inflateSync } from 'node:zlib';

/**
 * A deliberately small third PDF reader for the end-to-end suites — the cargo suite already reads
 * every PDF with lopdf; this one only proves that a file written by the real binary says the words
 * it should.
 *
 * Each stream is cut at the length its own dictionary declares, never by searching for
 * `endstream`: a photo's JPEG bytes can hold that word, and a search would then swallow the page
 * that follows it (D3's handover book). Image streams are skipped. A content stream is inflated
 * when it is deflated; every line shown — a `Tj` string, or a `TJ` array of literal and hex
 * strings, which the host writes for any line with a non-ASCII character — is decoded as WinAnsi.
 */

const WIN_ANSI = new TextDecoder('windows-1252');

function literal(token: string): string {
  const bytes = token
    .slice(1, -1)
    .replace(/\\([0-7]{1,3})/g, (_, octal: string) => String.fromCharCode(parseInt(octal, 8)))
    .replace(/\\([\\()])/g, '$1')
    .replace(/\\n/g, '\n');
  return WIN_ANSI.decode(Buffer.from(bytes, 'latin1'));
}

function hex(token: string): string {
  const digits = token.slice(1, -1).replace(/\s+/g, '');
  return WIN_ANSI.decode(Buffer.from(digits.length % 2 ? `${digits}0` : digits, 'hex'));
}

/** The streams of a PDF with their dictionaries, cut at each one's declared length. */
export function pdfStreams(bytes: Buffer): { dictionary: string; body: Buffer }[] {
  const raw = bytes.toString('latin1');
  const found: { dictionary: string; body: Buffer }[] = [];
  const object = /\d+\s+\d+\s+obj\s*(<<[\s\S]*?>>)\s*stream\r?\n/g;
  let match: RegExpExecArray | null;
  while ((match = object.exec(raw)) !== null) {
    const dictionary = match[1]!;
    const length = /\/Length\s+(\d+)\b(?!\s+\d+\s+R)/.exec(dictionary);
    const start = match.index + match[0].length;
    if (length === null) continue; // an indirect length: not one the host writes
    const end = start + Number(length[1]);
    found.push({ dictionary, body: bytes.subarray(start, end) });
    object.lastIndex = end;
  }
  return found;
}

/** The words a PDF shows, lines joined with a space. */
export function pdfText(bytes: Buffer): string {
  const lines: string[] = [];
  for (const { dictionary, body } of pdfStreams(bytes)) {
    if (/\/Subtype\s*\/Image/.test(dictionary)) continue;
    let content = body;
    if (/\/FlateDecode/.test(dictionary)) {
      try {
        content = inflateSync(body);
      } catch {
        continue;
      }
    }
    const text = content.toString('latin1');
    const shown =
      /\[((?:\((?:\\[\s\S]|[^\\)])*\)|<[0-9A-Fa-f\s]*>|[^\]])*)\]\s*TJ|(\((?:\\[\s\S]|[^\\)])*\))\s*Tj/g;
    let line: RegExpExecArray | null;
    while ((line = shown.exec(text)) !== null) {
      const strings = line[1] ?? line[2] ?? '';
      lines.push(
        (strings.match(/\((?:\\[\s\S]|[^\\)])*\)|<[0-9A-Fa-f\s]*>/g) ?? [])
          .map((token) => (token.startsWith('<') ? hex(token) : literal(token)))
          .join(''),
      );
    }
  }
  return lines.join(' ').replace(/\s+/g, ' ');
}

/** How many image XObjects a PDF holds. */
export function pdfImageCount(bytes: Buffer): number {
  return pdfStreams(bytes).filter(({ dictionary }) => /\/Subtype\s*\/Image/.test(dictionary))
    .length;
}
