import { useEffect, useRef, useState } from 'react';

import type { WorkSnapshot } from '@/domain/plan';

/**
 * A plan rewritten in one act, rather than a field at a time (F9): a template applied to the empty
 * breakdown, or every range taken as its duration.
 *
 * Two things follow such an act, and both must wait for the new plan to be drawn. The breakdown's
 * rows keep what was typed in them while they are on screen, so a row whose duration the host just
 * wrote must be drawn afresh — `generation` changes once the snapshot on screen is no longer the one
 * the act started from, and the rows are keyed by it. And the control that did it is gone (the empty
 * state, the ranges' buttons), so the focus goes to the heading this returns a ref for — never left
 * on a control that no longer exists (the F8 lesson, `replanningFocus.ts`).
 */
export function useRewritten(snapshot: WorkSnapshot) {
  const [before, setBefore] = useState<WorkSnapshot | null>(null);
  const [generation, setGeneration] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);

  // The act is done once the plan on screen is not the one it started from.
  if (before !== null && before !== snapshot) {
    setBefore(null);
    setGeneration((now) => now + 1);
  }

  useEffect(() => {
    if (generation === 0) return;
    const frame = window.requestAnimationFrame(() => heading.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [generation]);

  return {
    generation,
    heading,
    /** Say that the plan was rewritten, from the snapshot the act started from. */
    rewritten: (from: WorkSnapshot) => setBefore(from),
  };
}
