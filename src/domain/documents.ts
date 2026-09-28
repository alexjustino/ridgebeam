/**
 * Documents: the files a work owns, what each is, and what it is attached to.
 *
 * A document is copied into the work's folder by the host, typed by its bytes (a photo or a PDF;
 * everything else is refused there), and named by its hash, so the same file added twice is one
 * file. **The domain never sees the bytes**: it files documents by kind, lists them by what they are
 * attached to, counts them, and says what each attachment points at.
 *
 * An attachment names a stage, an activity, a decision, a diary entry, a commitment, a payment or
 * the work itself. One whose target is gone (removed, or edited out of the file) is listed as
 * **detached**, never dropped: the document is still the work's. Two attachments to the same target
 * are one.
 *
 * What this module is not: storage, a file reader, or text. It returns rows, codes and figures.
 */

import type { DiaryEntry } from './diary';
import { counted, type Figure, type ReportRow } from './figure';
import {
  compareText,
  type Document,
  type DocumentKind,
  type DocumentLink,
  type TargetKind,
  type WorkSnapshot,
} from './plan';

export type { Document, DocumentKind, DocumentLink, TargetKind } from './plan';

export const DOCUMENT_KINDS = [
  'photo',
  'quote',
  'drawing',
  'permit',
  'receipt',
  'contract',
  'other',
] as const satisfies readonly DocumentKind[];

export const TARGET_KINDS = [
  'work',
  'stage',
  'activity',
  'decision',
  'entry',
  'commitment',
  'payment',
] as const satisfies readonly TargetKind[];

/** One key per target, for maps and counts: `stage:<id>`, `entry:<seq>`. */
export function targetKey(link: DocumentLink): string {
  return `${link.targetKind}:${link.targetId}`;
}

/** A document's attachments, each target once, in the order first given. */
export function linksOf(document: Document): DocumentLink[] {
  const seen = new Set<string>();
  const links: DocumentLink[] = [];
  for (const link of document.links) {
    const key = targetKey(link);
    if (seen.has(key)) continue;
    seen.add(key);
    links.push(link);
  }
  return links;
}

/** The library's order: the newest first, by the day added, then by when it was recorded. */
function newestFirst(a: Document, b: Document): number {
  return (
    compareText(b.addedOn, a.addedOn) ||
    compareText(b.createdAt, a.createdAt) ||
    compareText(a.id, b.id)
  );
}

/** Every document attached to a target, newest first. */
export function documentsOf(snapshot: WorkSnapshot, target: DocumentLink): Document[] {
  const key = targetKey(target);
  return snapshot.documents
    .filter((document) => document.links.some((link) => targetKey(link) === key))
    .sort(newestFirst);
}

/** The documents filed under each kind, every kind present (empty when none), newest first. */
export function byKind(documents: readonly Document[]): Record<DocumentKind, Document[]> {
  const groups = Object.fromEntries(
    DOCUMENT_KINDS.map((kind) => [kind, [] as Document[]]),
  ) as Record<DocumentKind, Document[]>;
  for (const document of [...documents].sort(newestFirst)) groups[document.kind].push(document);
  return groups;
}

/** How many documents are attached to each target, by `targetKey`: the paperclip counts. */
export function documentCounts(snapshot: WorkSnapshot): Map<string, number> {
  const counts = new Map<string, number>();
  for (const document of snapshot.documents) {
    for (const link of linksOf(document)) {
      const key = targetKey(link);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return counts;
}

/** What an attachment points at, ready to be said: "Tiling", "Which tile", "#3". */
export interface TargetDescription {
  readonly targetKind: TargetKind;
  readonly targetId: string;
  /** The target is not there any more. The document stays; the chip says so. */
  readonly detached: boolean;
  /** The target's own name, as the person wrote it; `null` for an entry, a payment or a detached one. */
  readonly name: string | null;
  /** For an entry or a payment, its seq; `null` otherwise. */
  readonly seq: number | null;
  /** How the interface words it: `documents.target.<kind>`, or `documents.target.detached`. */
  readonly labelKey: string;
}

/** A seq written as text, or `null` when the text is not one. */
function seqOf(targetId: string): number | null {
  return /^[1-9]\d*$/.test(targetId) ? Number(targetId) : null;
}

/**
 * What an attachment points at. An entry is looked up in `entries` when they are given (the diary is
 * not in the snapshot); without them, any positive seq is taken to be there.
 */
export function describeTarget(
  snapshot: WorkSnapshot,
  link: DocumentLink,
  entries?: readonly DiaryEntry[],
): TargetDescription {
  const found = (name: string | null, seq: number | null): TargetDescription => ({
    targetKind: link.targetKind,
    targetId: link.targetId,
    detached: false,
    name,
    seq,
    labelKey: `documents.target.${link.targetKind}`,
  });
  const detached: TargetDescription = {
    targetKind: link.targetKind,
    targetId: link.targetId,
    detached: true,
    name: null,
    seq: null,
    labelKey: 'documents.target.detached',
  };
  const byId = <Row extends { id: string }>(rows: readonly Row[], nameOf: (row: Row) => string) => {
    const row = rows.find((each) => each.id === link.targetId);
    return row === undefined ? detached : found(nameOf(row), null);
  };

  switch (link.targetKind) {
    case 'work':
      return link.targetId === snapshot.work.workId ? found(snapshot.work.name, null) : detached;
    case 'stage':
      return byId(snapshot.stages, (row) => row.name);
    case 'activity':
      return byId(snapshot.activities, (row) => row.name);
    case 'decision':
      return byId(snapshot.decisions, (row) => row.name);
    case 'commitment':
      return byId(snapshot.commitments, (row) => row.label);
    case 'payment': {
      const seq = seqOf(link.targetId);
      return seq !== null && snapshot.payments.some((payment) => payment.seq === seq)
        ? found(null, seq)
        : detached;
    }
    case 'entry': {
      const seq = seqOf(link.targetId);
      if (seq === null) return detached;
      return entries === undefined || entries.some((entry) => entry.seq === seq)
        ? found(null, seq)
        : detached;
    }
    default:
      return detached;
  }
}

/** Every attachment whose target is gone, document by document: listed, never dropped. */
export function detachedLinks(
  snapshot: WorkSnapshot,
  entries?: readonly DiaryEntry[],
): Array<{ documentId: string; link: DocumentLink }> {
  return snapshot.documents.flatMap((document) =>
    linksOf(document)
      .filter((link) => describeTarget(snapshot, link, entries).detached)
      .map((link) => ({ documentId: document.id, link })),
  );
}

// ── Checking changes before the host is asked ────────────────────────────────

/** A change to a document's title or kind. */
export interface DocumentPatch {
  readonly title?: string;
  readonly kind?: string;
}

export type DocumentProblem =
  | { readonly code: 'title-empty' }
  | { readonly code: 'title-too-long' }
  | { readonly code: 'invalid-kind' }
  | { readonly code: 'invalid-target-kind' }
  | { readonly code: 'unknown-target' };

const TITLE_LIMIT = 200;

/** Check a change to a document: a title that says something, within 200 characters; a known kind. */
export function validateDocumentPatch(patch: DocumentPatch): DocumentProblem[] {
  const problems: DocumentProblem[] = [];
  if (patch.title !== undefined) {
    if (patch.title.trim() === '') problems.push({ code: 'title-empty' });
    if (patch.title.length > TITLE_LIMIT) problems.push({ code: 'title-too-long' });
  }
  if (patch.kind !== undefined && !(DOCUMENT_KINDS as readonly string[]).includes(patch.kind)) {
    problems.push({ code: 'invalid-kind' });
  }
  return problems;
}

/** Check an attachment before the host is asked: a kind of target that exists, and a target that is there. */
export function validateLink(
  snapshot: WorkSnapshot,
  link: DocumentLink,
  entries?: readonly DiaryEntry[],
): DocumentProblem[] {
  if (!(TARGET_KINDS as readonly string[]).includes(link.targetKind)) {
    return [{ code: 'invalid-target-kind' }];
  }
  return describeTarget(snapshot, link, entries).detached ? [{ code: 'unknown-target' }] : [];
}

// ── Figures ──────────────────────────────────────────────────────────────────

/** A row of a documents figure: one document. */
export interface DocumentRow extends ReportRow {
  readonly documentId: string;
  readonly kind: DocumentKind;
}

export const DOCUMENTS_LABEL_KEYS = {
  all: 'documents.figure.all',
  photo: 'documents.figure.photo',
  quote: 'documents.figure.quote',
  drawing: 'documents.figure.drawing',
  permit: 'documents.figure.permit',
  receipt: 'documents.figure.receipt',
  contract: 'documents.figure.contract',
  other: 'documents.figure.other',
} as const satisfies Record<DocumentKind | 'all', string>;

/**
 * The documents of one kind, or all of them, as a counted figure opening onto them, newest first:
 * "12 documents · 3 quotes · 2 permits".
 */
export function documentsFigure(
  snapshot: WorkSnapshot,
  kind: DocumentKind | 'all' = 'all',
): Figure<DocumentRow> {
  const rows = [...snapshot.documents]
    .filter((document) => kind === 'all' || document.kind === kind)
    .sort(newestFirst)
    .map((document) => ({
      key: `document:${document.id}`,
      itemId: document.id,
      title: document.title,
      day: document.addedOn,
      minutes: 0,
      documentId: document.id,
      kind: document.kind,
    }));
  return counted(`documents:${kind}`, DOCUMENTS_LABEL_KEYS[kind], rows);
}
