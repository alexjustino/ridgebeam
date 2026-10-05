import type { ComponentProps } from 'react';

import { FIELD_SURFACE } from './fieldSurface';

/**
 * The canonical text field, for text that has more than one line in it.
 *
 * It is an `Input` that grew: the same surface constant, so the two cannot
 * drift apart, with the control height replaced by a minimum of a few lines and
 * the vertical padding a single-line field gets from its height. It resizes
 * vertically only — a field that can be dragged wider than its column breaks
 * the layout it sits in. Its `ref` is a plain prop (React 19), for a caller that puts the focus
 * on it. A caller that says how many `rows` it wants gets that height: the minimum of a few lines
 * is for a field that says nothing (G1's agenda, a note under every item, was one long page).
 */
export function TextArea({ className = '', ...rest }: ComponentProps<'textarea'>) {
  return (
    <textarea
      className={[
        rest.rows === undefined ? 'min-h-24' : '',
        'resize-y py-2 leading-normal',
        FIELD_SURFACE,
        className,
      ].join(' ')}
      {...rest}
    />
  );
}
