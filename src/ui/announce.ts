/**
 * Say something to a screen reader without moving focus.
 *
 * Anything that changes without a click — a stage added, a choice kept, a work
 * opened — is announced here, and rendered by `Announcer` into a live region. Data, not a component:
 * a hook's `onSuccess` can call it without knowing about React trees.
 */

export const ANNOUNCE_EVENT = 'ridgebeam:announce';

export type Politeness = 'polite' | 'assertive';

export interface Announcement {
  text: string;
  politeness: Politeness;
}

export function announce(text: string, politeness: Politeness = 'polite'): void {
  if (typeof document === 'undefined') return;
  const detail: Announcement = { text, politeness };
  document.dispatchEvent(new CustomEvent<Announcement>(ANNOUNCE_EVENT, { detail }));
}
