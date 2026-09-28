import { createContext, useContext } from 'react';

import type { DocumentLink } from '@/domain/plan';

/**
 * The few ways one screen sends a person to another, already filtered (slice F7): a paperclip count
 * on a stage opens the Documents page on that stage's documents. One editing place for documents,
 * and elsewhere a count that links (DESIGN_SYSTEM §8) — this is the link. The dashboard's last
 * entries open the diary at that entry (F10), with the focus on it.
 */
export interface Navigation {
  openDocuments: (target: DocumentLink) => void;
  openDiary: (seq: number) => void;
  /**
   * Open the Plan's breakdown with the focus on a row (an activity's or a decision's id) or on the
   * People card's field that adds a person (F11: the Next question card's "Add a person").
   */
  openPlan: (focus: string) => void;
}

export const NavigationContext = createContext<Navigation>({
  openDocuments: () => undefined,
  openDiary: () => undefined,
  openPlan: () => undefined,
});

export function useNavigation(): Navigation {
  return useContext(NavigationContext);
}
