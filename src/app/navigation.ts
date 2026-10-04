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
  /**
   * Open Money by stage on one commitment, its payment plan open and the focus on it (D2: the Next
   * question's "How is this commitment to be paid?" answers by opening the plan, not inline).
   */
  openPaymentPlan: (commitmentId: string) => void;
  /**
   * Open Reports on the owner's snapshot card with the focus on its path field (D4: the dashboard's
   * "Snapshot for the owner…" goes to the card that writes it, rather than writing from there).
   */
  openSnapshot: () => void;
  /**
   * Open Settings on This work with the focus on the backup's path field (U1: the dashboard's
   * "Back up now…" goes to the one flow that writes a backup, rather than writing from there).
   */
  openBackup: () => void;
  /**
   * Open the Schedule (E1: after a change order is approved, the replanning it opened is closed by
   * taking the next baseline there).
   */
  openSchedule: () => void;
  /** Open the Plan on its Changes tab (E1: the dashboard's Changes card leads to the record). */
  openChanges: () => void;
  /** Open the Plan on its Snags tab (E4: the dashboard's Still to fix card leads to the list). */
  openSnags: () => void;
}

export const NavigationContext = createContext<Navigation>({
  openDocuments: () => undefined,
  openDiary: () => undefined,
  openPlan: () => undefined,
  openPaymentPlan: () => undefined,
  openSnapshot: () => undefined,
  openBackup: () => undefined,
  openSchedule: () => undefined,
  openChanges: () => undefined,
  openSnags: () => undefined,
});

export function useNavigation(): Navigation {
  return useContext(NavigationContext);
}
