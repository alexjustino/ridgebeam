import type { DocumentTarget } from '@/data/commands';
import type { Document, WorkSnapshot } from '@/domain/plan';
import { baseName } from '@/features/shell/drop';

/**
 * Which document of the work a photo just added through `document_add` became (slice E4): a snag
 * names its photos by the hash of a document of the work, so the interface adds the file first — the
 * same intake as Documents, attached to the work — and then reads the hash back.
 *
 * The host copies a file in once and names it by its bytes: a new file is a new document; a file
 * whose bytes the work already holds is the document it already was, now attached to the target too.
 * So the document is the one that is new, else the one newly attached to the target, else — the
 * same bytes already attached there — the one with the file's name, the latest. `null` when none of
 * these is found, which the screen says rather than guessing.
 *
 * Pure: the documents before and after, the target and the path in; a document out.
 */
export function addedDocument(
  before: readonly Document[],
  after: readonly Document[],
  target: DocumentTarget,
  path: string,
): Document | null {
  const name = baseName(path);
  const known = new Map(before.map((document) => [document.id, document]));
  const attached = (document: Document) =>
    document.links.some(
      (link) => link.targetKind === target.targetKind && link.targetId === target.targetId,
    );
  const latestFirst = (documents: readonly Document[]) =>
    [...documents].sort((a, b) =>
      a.fileName === name && b.fileName !== name
        ? -1
        : b.fileName === name && a.fileName !== name
          ? 1
          : b.createdAt.localeCompare(a.createdAt),
    );

  const fresh = after.filter((document) => !known.has(document.id));
  if (fresh.length > 0) return latestFirst(fresh)[0] ?? null;

  const newlyAttached = after.filter((document) => {
    const was = known.get(document.id);
    return attached(document) && (was === undefined || !attached(was));
  });
  if (newlyAttached.length > 0) return latestFirst(newlyAttached)[0] ?? null;

  const named = after.filter((document) => document.fileName === name && attached(document));
  return latestFirst(named)[0] ?? null;
}

/**
 * The target a snag's photo is added under: the work itself, as the documents' intake attaches a
 * file nothing else names. Not the stage — the host does not tie a snag's photo to its stage, and the
 * handover book prints a snag's photos with the snag, never a second time with the stage.
 */
export function snagPhotoTarget(snapshot: WorkSnapshot): DocumentTarget {
  return { targetKind: 'work', targetId: snapshot.work.workId };
}
