/**
 * How an edit on the plan reports back: a refusal is said once, at the top of the page, in the
 * host's sentence; the next edit that is kept takes it away. One channel for every card, so two
 * refusals never argue on screen.
 */
export interface Outcome {
  refused: (error: unknown) => void;
  kept: () => void;
}
