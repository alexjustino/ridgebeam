import { describe, expect, it } from 'vitest';

import { STAGE_STATES } from '@/domain/checks';

import { stageControls } from './stageControls';

/**
 * The breakdown's stage controls match the host's rules exactly (F11, decision 8c). The host's
 * `stage_move` refuses only a locked plan, never a closed stage; `rename_stage` and `remove_stage`
 * refuse a closed stage.
 */
describe("a stage's own controls", () => {
  it('a closed stage still moves up and down — stage_move does not refuse a closed stage', () => {
    expect(stageControls('closed').move).toBe(true);
  });

  it('a closed stage is neither renamed nor removed — the host refuses both', () => {
    expect(stageControls('closed')).toEqual({ move: true, rename: false, remove: false });
  });

  it.each(STAGE_STATES.filter((state) => state !== 'closed'))(
    'a %s stage offers every control',
    (state) => {
      expect(stageControls(state)).toEqual({ move: true, rename: true, remove: true });
    },
  );
});
