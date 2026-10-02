import { useSyncExternalStore } from 'react';

import type { TemplateNote } from '@/domain/templates/apply';

/**
 * What applying a template left for the person to know — a point given as a duration, text only in
 * the other language, the templates an include brought in — said once, on the Dashboard (and on the
 * breakdown, where a plan started from an empty work), until the person dismisses it.
 *
 * Kept in memory for the work it was applied to and nowhere else: the work stores its provenance,
 * never the notes (ADR-029), so closing the work or the window lets them go. Another work's notes
 * are never shown.
 */
export interface AppliedNotes {
  readonly workId: string;
  readonly title: string;
  readonly notes: readonly TemplateNote[];
}

let current: AppliedNotes | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** Keep the notes of a template just applied to this work — or none, when it left nothing to say. */
export function keepNotes(applied: AppliedNotes): void {
  current = applied.notes.length === 0 ? null : applied;
  emit();
}

export function dismissNotes(): void {
  current = null;
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The notes waiting for this work, or `null`. */
export function useAppliedNotes(workId: string): AppliedNotes | null {
  const notes = useSyncExternalStore(subscribe, () => current);
  return notes !== null && notes.workId === workId ? notes : null;
}
