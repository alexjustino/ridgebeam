import { useCallback, useSyncExternalStore } from 'react';

/**
 * The questions a person skipped on the Next question card, for this session (F11, decision 7):
 * kept in memory for the work they were skipped on — never in the work, never in the settings — so
 * leaving the Dashboard and coming back does not ask them again, and closing the window forgets
 * them. Another work's skips are never applied.
 */
interface Skipped {
  readonly workId: string;
  readonly keys: ReadonlySet<string>;
}

const NONE: ReadonlySet<string> = new Set();
let current: Skipped | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The keys skipped on this work, and the two ways to change them. */
export function useSkipped(workId: string) {
  const state = useSyncExternalStore(subscribe, () => current);
  const keys = state !== null && state.workId === workId ? state.keys : NONE;

  const skip = useCallback(
    (key: string) => {
      const before = current !== null && current.workId === workId ? current.keys : NONE;
      current = { workId, keys: new Set([...before, key]) };
      emit();
    },
    [workId],
  );

  const askAgain = useCallback(() => {
    current = null;
    emit();
  }, []);

  return { keys, skip, askAgain };
}
