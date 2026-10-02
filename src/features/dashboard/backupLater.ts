import { useCallback, useSyncExternalStore } from 'react';

/**
 * The works whose backup reminder was put off with "Not now", for this session (U1, decision 3):
 * kept in memory and nowhere else — never in the work, never in the settings — so leaving the
 * Dashboard and coming back does not ask again, and closing the window forgets it. Another work's
 * "Not now" is never applied. The pattern of the Next question's skips (`skipped.ts`).
 */
let later: ReadonlySet<string> = new Set();
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Whether this work's reminder was put off in this session, and the way to put it off. */
export function useBackupLater(workId: string): { putOff: boolean; notNow: () => void } {
  const state = useSyncExternalStore(subscribe, () => later);
  const notNow = useCallback(() => {
    later = new Set([...later, workId]);
    for (const listener of listeners) listener();
  }, [workId]);
  return { putOff: state.has(workId), notNow };
}
