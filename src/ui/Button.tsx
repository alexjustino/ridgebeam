import type { ButtonHTMLAttributes, ReactNode } from 'react';

/**
 * The canonical button. Nothing in the product draws its own.
 *
 * Three appearances, matching Fluent: `accent` for the one primary action on a
 * surface, `standard` for everything else, `subtle` for actions that live
 * inside dense chrome such as a toolbar.
 *
 * Two sizes: `standard` takes the density's control height; `compact` is for the title bar, where
 * the strip is one control tall and a control must fit inside it.
 */

export type ButtonAppearance = 'accent' | 'standard' | 'subtle';
export type ButtonSize = 'standard' | 'compact';

const SIZE: Record<ButtonSize, string> = {
  standard: 'h-(--density-control) px-3 text-body',
  compact: 'h-6 px-2 text-caption',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  appearance?: ButtonAppearance;
  size?: ButtonSize;
  icon?: ReactNode;
}

const APPEARANCE: Record<ButtonAppearance, string> = {
  accent:
    'bg-accent text-fg-on-accent border-transparent hover:bg-accent-hover active:bg-accent-active',
  standard: 'bg-card text-fg border-stroke hover:bg-card-hover active:bg-card-active',
  subtle: 'bg-transparent text-fg border-transparent hover:bg-card-hover active:bg-card-active',
};

export function Button({
  appearance = 'standard',
  size = 'standard',
  icon,
  className = '',
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type="button"
      className={[
        'inline-flex items-center justify-center gap-2 rounded-md border',
        SIZE[size],
        'font-semibold whitespace-nowrap',
        'transition-colors duration-100 ease-easy',
        'disabled:cursor-not-allowed disabled:text-fg-disabled disabled:bg-card disabled:border-stroke-subtle',
        APPEARANCE[appearance],
        className,
      ].join(' ')}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
}
