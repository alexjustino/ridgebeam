import { useCallback } from 'react';

/**
 * Set when a replanning has just been opened. The button that opened the dialog goes away with the
 * locked state, so the dialog cannot hand focus back to it; the "Replanning since…" notice that takes
 * its place takes the focus instead — once, so that visiting a page later never moves it.
 */
let focusNextReplanning = false;

/**
 * A ref for the "Replanning since…" notice: it takes the focus when it appears because a replanning
 * was just opened, after the dialog has let go of it. Focusable by script only (`tabIndex={-1}`).
 */
export function useReplanningFocus(): (element: HTMLElement | null) => void {
  return useCallback((element: HTMLElement | null) => {
    if (element === null || !focusNextReplanning) return;
    focusNextReplanning = false;
    requestAnimationFrame(() => {
      if (element.isConnected) element.focus();
    });
  }, []);
}

/** Called by the replan dialog when the host has opened the replanning. */
export function focusReplanningNext(): void {
  focusNextReplanning = true;
}
