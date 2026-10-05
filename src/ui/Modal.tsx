import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { useFocusTrap } from './useFocusTrap';

/**
 * A surface that takes over the window for one exchange.
 *
 * The dialog sits high rather than centred — a palette or a prompt is read from
 * the top, and the eye is already there. Escape closes it; the scrim closes on
 * click but is not a control, so the keyboard route is Escape or whatever the
 * content offers. Focus moves into the panel on open so a keyboard user is not
 * left on the page underneath.
 *
 * A dialog may ask "are you sure" over another (G3: replacing a template of yours from the Export
 * dialog, removing one from the New work dialog's picker). Escape then closes only the one on top —
 * the open dialogs are a stack — and `over` draws it on the document's body rather than inside the
 * dialog under it, whose panel would otherwise clip it.
 */
/** The dialogs open now, the last on top. */
const OPEN: symbol[] = [];

export function Modal({
  open,
  label,
  onClose,
  children,
  width = 'md',
  height = 'content',
  over = false,
}: {
  open: boolean;
  /** The accessible name. A dialog with no name is a dialog nobody can use. */
  label: string;
  onClose: () => void;
  children: ReactNode;
  width?: 'md' | 'lg';
  /**
   * `content` grows with what the dialog holds, up to 70 % of the window. `fixed` is always that
   * tall: for a dialog whose content changes while a person is about to press its buttons (a
   * preview read when a field loses focus), so the footer never moves out from under the pointer
   * between the press and the release (F11: a click on Restore missed its button that way).
   */
  height?: 'content' | 'fixed';
  /** Drawn over another dialog: on the document's body, so the dialog under it cannot clip it. */
  over?: boolean;
}) {
  const panel = useRef<HTMLDivElement>(null);
  // The latest `onClose`, so the dialog keeps its place in the stack when its owner re-renders.
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });

  useEffect(() => {
    if (!open) return;

    const me = Symbol('modal');
    OPEN.push(me);
    const onKeyDown = (event: KeyboardEvent) => {
      // Only the dialog on top answers: Escape closes one dialog, never the one under it too.
      if (event.key === 'Escape' && OPEN[OPEN.length - 1] === me) {
        event.stopPropagation();
        close.current();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      OPEN.splice(OPEN.indexOf(me), 1);
    };
  }, [open]);

  // Tab stays inside while it is open; focus goes back to where it was after.
  useFocusTrap(panel, open);

  if (!open) return null;

  const dialog = (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh]">
      <div aria-hidden="true" className="absolute inset-0 bg-overlay" onClick={onClose} />

      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className={[
          'relative flex w-full flex-col overflow-hidden rounded-xl border border-stroke',
          height === 'fixed' ? 'h-[70vh]' : 'max-h-[70vh]',
          'bg-flyout shadow-dialog backdrop-blur-xl focus:outline-none',
          width === 'lg' ? 'max-w-3xl' : 'max-w-xl',
        ].join(' ')}
      >
        {children}
      </div>
    </div>
  );

  return over ? createPortal(dialog, document.body) : dialog;
}
