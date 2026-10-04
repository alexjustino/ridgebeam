import { useSyncExternalStore } from 'react';

import type { RestoreReport } from '@/data/commands';

/**
 * What a restore found — the entries read back, the chain verified, the documents re-hashed, the
 * recent row moved — said once, on the Dashboard of the work it restored, until the person dismisses
 * it (F11, decision 2).
 *
 * The Start screen that asked for the restore is gone the moment the work opens, so the report is
 * handed on here. Kept in memory for that work and nowhere else: closing the work or the window lets
 * it go, and another work never shows it.
 */
let current: RestoreReport | null = null;
// Whether the report has been shown once: it takes the focus and is announced the first time only,
// not every time the Dashboard is opened again before it is dismissed.
let announced = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function keepRestored(report: RestoreReport): void {
  current = report;
  announced = false;
  emit();
}

/** True the first time it is asked after a restore, and never again for that report. */
export function firstShowing(): boolean {
  if (announced) return false;
  announced = true;
  return true;
}

export function dismissRestored(): void {
  current = null;
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The restore report waiting for this work, or `null`. */
export function useRestored(workId: string): RestoreReport | null {
  const report = useSyncExternalStore(subscribe, () => current);
  return report !== null && report.workId === workId ? report : null;
}
