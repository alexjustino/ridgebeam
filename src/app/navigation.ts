import { createContext, useContext } from 'react';

import type { DocumentLink } from '@/domain/plan';

/**
 * The few ways one screen sends a person to another, already filtered (slice F7): a paperclip count
 * on a stage opens the Documents page on that stage's documents. One editing place for documents,
 * and elsewhere a count that links (DESIGN_SYSTEM §8) — this is the link.
 */
export interface Navigation {
  openDocuments: (target: DocumentLink) => void;
}

export const NavigationContext = createContext<Navigation>({ openDocuments: () => undefined });

export function useNavigation(): Navigation {
  return useContext(NavigationContext);
}
