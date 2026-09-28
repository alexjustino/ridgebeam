import type { StageState } from '@/domain/checks';

/**
 * Which of a stage's own controls the breakdown offers, by the stage's state — exactly the host's
 * rules, neither stricter nor looser (F11, decision 8c):
 *
 * - **move** (`stage_move`) is refused only for a locked plan (approved, no replanning open) — never
 *   for a closed stage: where a closed stage sits among the others is not something it records. So
 *   Move up, Move down and Alt+Arrow stay offered on a closed stage.
 * - **rename** (`rename_stage`) and **remove** (`remove_stage`) are refused for a closed stage
 *   (`refuse_if_stage_closed`), so those two are disabled there, with the closed note saying why.
 *
 * A locked plan disables nothing here: the host's `plan_approved` sentence is said on the row that
 * tried (DESIGN_SYSTEM §8, a locked plan says why).
 */
export interface StageControls {
  move: boolean;
  rename: boolean;
  remove: boolean;
}

export function stageControls(state: StageState): StageControls {
  const closed = state === 'closed';
  return { move: true, rename: !closed, remove: !closed };
}
