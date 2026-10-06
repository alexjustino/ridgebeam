import { useCallback, useSyncExternalStore } from 'react';

/** The Diary's two views (G6, decision 5): day by day, or the work told in photos. */
export const DIARY_VIEWS = ['days', 'story'] as const;

export type DiaryView = (typeof DIARY_VIEWS)[number];

/**
 * The view the Diary was last left on, for this session: kept in memory and nowhere else — never
 * in the work, never in the settings — so leaving the Diary and coming back opens it where it was,
 * and closing the window forgets it (DESIGN_SYSTEM §8, _a story of photos runs first to last_). The
 * pattern of the dashboard's "Not now" (`backupLater.ts`).
 */
let current: DiaryView = 'days';
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function set(next: DiaryView): void {
  if (next === current) return;
  current = next;
  for (const listener of listeners) listener();
}

/** The Diary's view in this session, and the way to change it. */
export function useDiaryView(): [DiaryView, (next: DiaryView) => void] {
  const view = useSyncExternalStore(subscribe, () => current);
  const choose = useCallback((next: DiaryView) => set(next), []);
  return [view, choose];
}

/** Back to day by day, as a new session starts: for the tests, which share one module. */
export function forgetDiaryView(): void {
  set('days');
}
