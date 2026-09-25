import { useCallback, type KeyboardEvent } from 'react';

import { useMove, type MoveKind } from '@/data/queries';
import { breakdown } from '@/domain/arrangements';
import { moved, type Direction } from '@/domain/ordering';
import { roomsInOrder, type WorkSnapshot } from '@/domain/plan';
import { useI18n } from '@/i18n/useI18n';
import { announce } from '@/ui/announce';

import type { Outcome } from './outcome';

/**
 * Alt+ArrowUp and Alt+ArrowDown, from any control inside a row, are that row's Move up and Move
 * down (DESIGN_SYSTEM §8, the keyboard reorder rule). The chord is claimed — so a select does not
 * open on it — and stops at the innermost row, so an activity moves inside its stage rather than
 * taking the stage with it.
 */
export function chordDirection(event: KeyboardEvent): Direction | null {
  if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return null;
  if (event.key === 'ArrowUp') return 'up';
  if (event.key === 'ArrowDown') return 'down';
  return null;
}

/** Where a row stands after a move, in the words the screen numbers it with. */
function positionOf(snapshot: WorkSnapshot, kind: MoveKind, id: string): string {
  if (kind === 'room') {
    return String(roomsInOrder(snapshot).findIndex((room) => room.id === id) + 1);
  }
  return breakdown(snapshot).find((row) => row.id === id)?.number ?? '';
}

/**
 * Move one row one place, by button or by chord, and say where it went.
 *
 * At an edge nothing is asked of the host — the domain's `moved` already says the order would not
 * change — and the announcement says the row is already first or last, so a key press is never
 * met with silence. After the host answers, focus is put back on the control that had it: the row
 * moved in the document, and a keyboard user must not be left on the body.
 */
export function useMover(outcome: Outcome) {
  const { t } = useI18n();
  const move = useMove();
  const { mutate } = move;

  const go = useCallback(
    (
      kind: MoveKind,
      id: string,
      direction: Direction,
      siblings: readonly string[],
      name: string,
    ) => {
      const after = moved(siblings, id, direction);
      if (after.every((each, index) => each === siblings[index])) {
        announce(
          t(direction === 'up' ? 'plan.move.alreadyFirst' : 'plan.move.alreadyLast', { name }),
        );
        return;
      }
      const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      mutate(
        { kind, id, direction },
        {
          onSuccess: (snapshot) => {
            outcome.kept();
            announce(t('plan.move.done', { name, number: positionOf(snapshot, kind, id) }));
            window.requestAnimationFrame(() => {
              if (focused !== null && focused.isConnected && document.activeElement !== focused) {
                focused.focus();
              }
            });
          },
          onError: outcome.refused,
        },
      );
    },
    [mutate, outcome, t],
  );

  return { go, pending: move.isPending };
}
