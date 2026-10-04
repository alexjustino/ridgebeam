import { useRef } from 'react';

import { useAddDocuments } from '@/data/queries';
import type { WorkSnapshot } from '@/domain/plan';
import { useI18n } from '@/i18n/useI18n';

import { addedDocument, snagPhotoTarget } from './snagPhoto';

/** What adding a snag's photo came to: its hash and the plan with it, or the sentence why not. */
export type SnagPhotoAdded =
  | { readonly ok: true; readonly hash: string; readonly snapshot: WorkSnapshot }
  | { readonly ok: false; readonly reason: string };

/**
 * Add a snag's photo to the work's documents, attached to the work, and give back its hash
 * (decision 2: a snag names its photos by the hash of a document of the work). A path already added
 * in this form is not added twice: its hash is remembered. The host's refusal of the file comes back
 * as its own sentence.
 */
export function useAddSnagPhoto(snapshot: WorkSnapshot) {
  const { t, describeError } = useI18n();
  const add = useAddDocuments();
  const added = useRef(new Map<string, string>());

  const addPhoto = async (path: string): Promise<SnagPhotoAdded> => {
    const known = added.current.get(path);
    if (known !== undefined) return { ok: true, hash: known, snapshot };
    const target = snagPhotoTarget(snapshot);
    try {
      // Attached to the work (`target: null`), as a file chosen on Documents with no target is.
      const result = await add.mutateAsync({ paths: [path], kind: 'photo', target: null });
      const refused = result.refused[0];
      if (refused !== undefined) {
        return { ok: false, reason: t('snags.photo.refused', { reason: refused.reason }) };
      }
      const document = addedDocument(snapshot.documents, result.snapshot.documents, target, path);
      if (document === null) return { ok: false, reason: t('snags.photo.notFound') };
      added.current.set(path, document.fileHash);
      return { ok: true, hash: document.fileHash, snapshot: result.snapshot };
    } catch (error) {
      return { ok: false, reason: describeError(error) };
    }
  };

  return { addPhoto, adding: add.isPending };
}
