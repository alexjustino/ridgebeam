import { Checkmark12Filled } from '@fluentui/react-icons';

/**
 * The canonical checkbox.
 *
 * The real `<input type="checkbox">` **is** the box: its native look is removed and it is drawn
 * from the token layer, so it carries the accessible role, the keyboard behaviour, the form
 * semantics and the global `:focus-visible` ring for free, and it is the element a pointer, a
 * keyboard and an automation driver all reach. The check mark is drawn over it and takes no
 * pointer events. (A box drawn beside an invisible input is a box that tools consider not there.)
 */
export function Checkbox({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** The accessible name. Required — a box with no name is a box nobody can use. */
  label: string;
  disabled?: boolean;
}) {
  return (
    <span className="relative inline-grid size-5 shrink-0 place-items-center">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-label={label}
        onChange={(event) => onChange(event.target.checked)}
        className={[
          'peer size-4 cursor-pointer appearance-none rounded-sm border bg-card',
          'transition-colors duration-100 ease-easy',
          'border-stroke-strong hover:border-fg-secondary',
          'checked:border-accent checked:bg-accent checked:hover:border-accent',
          'disabled:cursor-not-allowed disabled:border-stroke-subtle disabled:bg-card',
        ].join(' ')}
      />
      <Checkmark12Filled
        aria-hidden="true"
        className="pointer-events-none absolute hidden text-fg-on-accent peer-checked:block"
      />
    </span>
  );
}
