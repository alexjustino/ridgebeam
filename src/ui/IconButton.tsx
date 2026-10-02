import type { ComponentProps, ReactNode } from 'react';

/**
 * A button that is only an icon (DESIGN_SYSTEM §5).
 *
 * An icon is never the only cue, so `label` is required by the type: it becomes the accessible
 * name and the tooltip both, and a person who cannot tell the arrow from the chevron can still
 * read what it does. The subtle appearance, one control tall and square, for dense rows.
 */
export function IconButton({
  label,
  icon,
  className = '',
  ...rest
}: Omit<ComponentProps<'button'>, 'aria-label' | 'title' | 'children'> & {
  label: string;
  icon: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={[
        'inline-grid size-(--density-control) shrink-0 place-items-center rounded-md border',
        'border-transparent bg-transparent text-fg',
        'transition-colors duration-100 ease-easy hover:bg-card-hover active:bg-card-active',
        'disabled:cursor-not-allowed disabled:text-fg-disabled',
        className,
      ].join(' ')}
      {...rest}
    >
      <span aria-hidden="true">{icon}</span>
    </button>
  );
}
