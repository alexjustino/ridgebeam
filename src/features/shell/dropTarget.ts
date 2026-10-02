import { createContext, useContext, useEffect, useRef } from 'react';

import type { DropPlace } from './drop';

/**
 * What a place does with a drop routed to it: the paths it takes, and the names of what was left
 * out, for the place to say beside the control that would have chosen them (DESIGN_SYSTEM §8, _a
 * refused file is named, with the reason, under the control that chose it_).
 */
export type DropHandler = (taken: readonly string[], refused: readonly string[]) => void;

/** The one listener's registry: a place on screen says it is there, and what it does. */
export interface DropRegistry {
  /** Returns the function that takes the place off again. */
  register: (place: DropPlace, handler: DropHandler) => () => void;
}

export const DropContext = createContext<DropRegistry>({ register: () => () => undefined });

/**
 * Take the drops routed to `place` while this component is on screen, through `handler` — the same
 * function the place's own dialog flow calls with chosen paths (drop is choose). The latest handler
 * is used, so it may close over state without registering again on every render.
 */
export function useDropTarget(place: DropPlace, handler: DropHandler): void {
  const { register } = useContext(DropContext);
  const latest = useRef(handler);
  useEffect(() => {
    latest.current = handler;
  });
  useEffect(
    () => register(place, (taken, refused) => latest.current(taken, refused)),
    [register, place],
  );
}
