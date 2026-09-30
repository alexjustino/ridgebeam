import { useMemo } from 'react';

import { useDiary } from '@/data/queries';
import type { WorkSnapshot } from '@/domain/plan';
import type { Schedule } from '@/domain/schedule';
import { finishProbability, type FinishProbabilityResult } from '@/domain/schedule/probability';

/**
 * The finish as a probability (D1), for a screen: the domain's simulation over the snapshot, the
 * schedule and the diary — what has already happened is not simulated — computed once per snapshot
 * and kept while it does not change. The Schedule, the Dashboard and the weekly report all ask this
 * same question with the same three inputs, so they give the same seeded numbers; nothing of it is
 * stored anywhere.
 *
 * `null` while the diary is still being read: a chance computed without it would be replaced a
 * moment later by another, and two readings of one fact must not disagree even for that moment. A
 * diary that cannot be read is taken as empty, so the page still says what the plan alone gives.
 */
export function useFinishProbability(
  snapshot: WorkSnapshot,
  scheduled: Schedule,
): FinishProbabilityResult | null {
  const diary = useDiary(true);
  const entries = diary.isError ? EMPTY : diary.data;
  return useMemo(
    () =>
      entries === undefined ? null : finishProbability(snapshot, scheduled, { entries: entries }),
    [snapshot, scheduled, entries],
  );
}

const EMPTY: readonly never[] = [];
